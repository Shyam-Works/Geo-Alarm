// Enhanced IndexedDB utility class for GeoAlarm
class GeoAlarmDB {
  constructor() {
    this.dbName = 'GeoAlarmDB';
    this.version = 2;
    this.db = null;
  }

  // Open database connection
  async open() {
    if (this.db) return this.db;

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);
      
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        this.db = request.result;
        resolve(this.db);
      };
      
      request.onupgradeneeded = (event) => {
        const db = event.target.result;
        
        // Create locations store
        if (!db.objectStoreNames.contains('locations')) {
          const locationsStore = db.createObjectStore('locations', { 
            keyPath: 'timestamp' 
          });
          locationsStore.createIndex('timestamp', 'timestamp', { unique: false });
        }
        
        // Create alarms store
        if (!db.objectStoreNames.contains('alarms')) {
          const alarmsStore = db.createObjectStore('alarms', { 
            keyPath: 'createdAt'
          });
          alarmsStore.createIndex('name', 'name', { unique: false });
          alarmsStore.createIndex('triggered', 'triggered', { unique: false });
        }

        // Create settings store
        if (!db.objectStoreNames.contains('settings')) {
          const settingsStore = db.createObjectStore('settings', { 
            keyPath: 'key' 
          });
        }

        // Create sync queue store
        if (!db.objectStoreNames.contains('syncQueue')) {
          const syncStore = db.createObjectStore('syncQueue', { 
            keyPath: 'id',
            autoIncrement: true 
          });
          syncStore.createIndex('timestamp', 'timestamp', { unique: false });
          syncStore.createIndex('processed', 'processed', { unique: false });
        }
      };
    });
  }

  // Generic method to perform transactions
  async performTransaction(storeName, mode, operation) {
    try {
      const db = await this.open();
      const transaction = db.transaction([storeName], mode);
      const store = transaction.objectStore(storeName);
      
      return await operation(store, transaction);
    } catch (error) {
      console.error(`Transaction failed for ${storeName}:`, error);
      throw error;
    }
  }

  // Save alarms
  async saveAlarms(alarms) {
    return this.performTransaction('alarms', 'readwrite', async (store) => {
      // Clear existing alarms
      await this.clearStore(store);
      
      // Add new alarms
      const promises = alarms.map(alarm => this.addRecord(store, {
        ...alarm,
        syncedAt: Date.now()
      }));
      
      await Promise.all(promises);
      console.log('Alarms saved to IndexedDB:', alarms.length);
      
      // Sync with service worker
      this.syncWithServiceWorker('SYNC_ALARMS', { alarms });
    });
  }

  // Load alarms
  async loadAlarms() {
    return this.performTransaction('alarms', 'readonly', async (store) => {
      const alarms = await this.getAllRecords(store);
      console.log('Alarms loaded from IndexedDB:', alarms.length);
      return alarms || [];
    });
  }

  // Save settings
  async saveSettings(settings) {
    return this.performTransaction('settings', 'readwrite', async (store) => {
      const promises = Object.entries(settings).map(([key, value]) =>
        this.putRecord(store, { key, value, updatedAt: Date.now() })
      );
      await Promise.all(promises);
      console.log('Settings saved to IndexedDB');
    });
  }

  // Load settings
  async loadSettings() {
    return this.performTransaction('settings', 'readonly', async (store) => {
      const records = await this.getAllRecords(store);
      const settings = {};
      
      records.forEach(record => {
        settings[record.key] = record.value;
      });
      
      console.log('Settings loaded from IndexedDB:', settings);
      return settings;
    });
  }

  // Save location update
  async saveLocationUpdate(location, metadata = {}) {
    return this.performTransaction('locations', 'readwrite', async (store) => {
      const locationData = {
        timestamp: Date.now(),
        latitude: location[0],
        longitude: location[1],
        accuracy: metadata.accuracy || null,
        speed: metadata.speed || null,
        heading: metadata.heading || null,
        ...metadata
      };
      
      await this.addRecord(store, locationData);
      
      // Clean up old locations (keep only last 100)
      await this.cleanupOldLocations(store);
      
      return locationData;
    });
  }

  // Get recent locations
  async getRecentLocations(limit = 10) {
    return this.performTransaction('locations', 'readonly', async (store) => {
      const locations = await this.getAllRecords(store);
      return locations
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, limit);
    });
  }

  // Add to sync queue
  async addToSyncQueue(type, data) {
    return this.performTransaction('syncQueue', 'readwrite', async (store) => {
      const queueItem = {
        type,
        data,
        timestamp: Date.now(),
        processed: false,
        retryCount: 0
      };
      
      const result = await this.addRecord(store, queueItem);
      console.log('Added to sync queue:', type);
      return result;
    });
  }

  // Get pending sync items
  async getPendingSyncItems() {
    return this.performTransaction('syncQueue', 'readonly', async (store) => {
      const index = store.index('processed');
      return await this.getAllRecordsByIndex(index, false);
    });
  }

  // Mark sync item as processed
  async markSyncItemProcessed(id) {
    return this.performTransaction('syncQueue', 'readwrite', async (store) => {
      const item = await this.getRecord(store, id);
      if (item) {
        item.processed = true;
        item.processedAt = Date.now();
        await this.putRecord(store, item);
      }
    });
  }

  // Clean up old locations
  async cleanupOldLocations(store, maxRecords = 100) {
    try {
      const allRecords = await this.getAllRecords(store);
      if (allRecords.length > maxRecords) {
        // Sort by timestamp and remove oldest
        allRecords.sort((a, b) => a.timestamp - b.timestamp);
        const recordsToDelete = allRecords.slice(0, allRecords.length - maxRecords);
        
        const promises = recordsToDelete.map(record => 
          this.deleteRecord(store, record.timestamp)
        );
        await Promise.all(promises);
        
        console.log(`Cleaned up ${recordsToDelete.length} old location records`);
      }
    } catch (error) {
      console.error('Failed to cleanup old locations:', error);
    }
  }

  // Clean up old sync queue items
  async cleanupSyncQueue(maxAge = 86400000) { // 24 hours
    return this.performTransaction('syncQueue', 'readwrite', async (store) => {
      const cutoffTime = Date.now() - maxAge;
      const index = store.index('timestamp');
      const oldItems = await this.getAllRecordsByIndex(index, IDBKeyRange.upperBound(cutoffTime));
      
      const promises = oldItems.map(item => this.deleteRecord(store, item.id));
      await Promise.all(promises);
      
      console.log(`Cleaned up ${oldItems.length} old sync queue items`);
    });
  }

  // Generic helper methods
  addRecord(store, record) {
    return new Promise((resolve, reject) => {
      const request = store.add(record);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  putRecord(store, record) {
    return new Promise((resolve, reject) => {
      const request = store.put(record);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  getRecord(store, key) {
    return new Promise((resolve, reject) => {
      const request = store.get(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  deleteRecord(store, key) {
    return new Promise((resolve, reject) => {
      const request = store.delete(key);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  getAllRecords(store) {
    return new Promise((resolve, reject) => {
      const request = store.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  getAllRecordsByIndex(index, query) {
    return new Promise((resolve, reject) => {
      const request = query ? index.getAll(query) : index.getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  clearStore(store) {
    return new Promise((resolve, reject) => {
      const request = store.clear();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Sync with service worker
  syncWithServiceWorker(type, data) {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type, data });
    }
  }

  // Test database connectivity
  async testConnection() {
    try {
      const db = await this.open();
      console.log('Database connection successful');
      return true;
    } catch (error) {
      console.error('Database connection failed:', error);
      return false;
    }
  }

  // Get database stats
  async getStats() {
    try {
      const db = await this.open();
      const stats = {};
      
      const stores = ['alarms', 'locations', 'settings', 'syncQueue'];
      
      for (const storeName of stores) {
        const transaction = db.transaction([storeName], 'readonly');
        const store = transaction.objectStore(storeName);
        const count = await new Promise((resolve, reject) => {
          const request = store.count();
          request.onsuccess = () => resolve(request.result);
          request.onerror = () => reject(request.error);
        });
        stats[storeName] = count;
      }
      
      console.log('Database stats:', stats);
      return stats;
    } catch (error) {
      console.error('Failed to get database stats:', error);
      return {};
    }
  }

  // Export data for backup
  async exportData() {
    try {
      const data = {
        alarms: await this.loadAlarms(),
        settings: await this.loadSettings(),
        locations: await this.getRecentLocations(50),
        exportedAt: new Date().toISOString()
      };
      
      console.log('Data exported:', data);
      return data;
    } catch (error) {
      console.error('Failed to export data:', error);
      throw error;
    }
  }

  // Import data from backup
  async importData(data) {
    try {
      if (data.alarms) {
        await this.saveAlarms(data.alarms);
      }
      
      if (data.settings) {
        await this.saveSettings(data.settings);
      }
      
      console.log('Data imported successfully');
      return true;
    } catch (error) {
      console.error('Failed to import data:', error);
      throw error;
    }
  }

  // Close database connection
  close() {
    if (this.db) {
      this.db.close();
      this.db = null;
    }
  }
}

// Service Worker Manager for better communication
class ServiceWorkerManager {
  constructor() {
    this.registration = null;
    this.isSupported = 'serviceWorker' in navigator;
    this.messageHandlers = new Map();
  }

  // Register service worker
  async register() {
    if (!this.isSupported) {
      console.warn('Service Worker not supported');
      return null;
    }

    try {
      this.registration = await navigator.serviceWorker.register('/sw.js', {
        scope: '/'
      });

      console.log('Service Worker registered:', this.registration);

      // Listen for messages
      navigator.serviceWorker.addEventListener('message', (event) => {
        this.handleMessage(event);
      });

      // Handle registration updates
      this.registration.addEventListener('updatefound', () => {
        console.log('Service Worker update found');
      });

      return this.registration;
    } catch (error) {
      console.error('Service Worker registration failed:', error);
      return null;
    }
  }

  // Send message to service worker
  async sendMessage(type, data = {}) {
    if (!this.isSupported || !navigator.serviceWorker.controller) {
      console.warn('Cannot send message: Service Worker not available');
      return false;
    }

    try {
      navigator.serviceWorker.controller.postMessage({ type, data });
      return true;
    } catch (error) {
      console.error('Failed to send message to service worker:', error);
      return false;
    }
  }

  // Handle messages from service worker
  handleMessage(event) {
    const { type, ...data } = event.data;
    
    if (this.messageHandlers.has(type)) {
      const handler = this.messageHandlers.get(type);
      handler(data);
    } else {
      console.log('Unhandled service worker message:', type, data);
    }
  }

  // Register message handler
  onMessage(type, handler) {
    this.messageHandlers.set(type, handler);
  }

  // Remove message handler
  offMessage(type) {
    this.messageHandlers.delete(type);
  }

  // Request background sync
  async requestBackgroundSync(tag = 'background-location-sync') {
    if (this.registration && this.registration.sync) {
      try {
        await this.registration.sync.register(tag);
        console.log('Background sync requested:', tag);
        return true;
      } catch (error) {
        console.error('Failed to register background sync:', error);
        return false;
      }
    }
    return false;
  }

  // Check if service worker is active
  isActive() {
    return this.isSupported && 
           navigator.serviceWorker.controller && 
           this.registration && 
           this.registration.active;
  }

  // Get service worker state
  getState() {
    if (!this.isSupported) return 'not-supported';
    if (!this.registration) return 'not-registered';
    if (!navigator.serviceWorker.controller) return 'not-controlled';
    if (this.registration.installing) return 'installing';
    if (this.registration.waiting) return 'waiting';
    if (this.registration.active) return 'active';
    return 'unknown';
  }

  // Send ping to test communication
  async ping() {
    return new Promise((resolve) => {
      if (!this.isActive()) {
        resolve(false);
        return;
      }

      const channel = new MessageChannel();
      
      channel.port1.onmessage = (event) => {
        if (event.data.type === 'PONG') {
          resolve(true);
        }
      };

      navigator.serviceWorker.controller.postMessage(
        { type: 'PING' }, 
        [channel.port2]
      );

      // Timeout after 5 seconds
      setTimeout(() => resolve(false), 5000);
    });
  }
}

// Utility functions for better geolocation handling
class LocationManager {
  constructor() {
    this.watchId = null;
    this.lastKnownLocation = null;
    this.lastLocationTime = null;
    this.isTracking = false;
    this.callbacks = {
      onLocationUpdate: null,
      onError: null
    };
  }

  // Start continuous location tracking
  startTracking(options = {}) {
    if (!navigator.geolocation) {
      console.error('Geolocation not supported');
      return false;
    }

    if (this.isTracking) {
      console.log('Already tracking location');
      return true;
    }

    const defaultOptions = {
      enableHighAccuracy: true,
      timeout: 10000,
      maximumAge: 30000
    };

    const geoOptions = { ...defaultOptions, ...options };

    this.watchId = navigator.geolocation.watchPosition(
      (position) => this.handleLocationUpdate(position),
      (error) => this.handleLocationError(error),
      geoOptions
    );

    this.isTracking = true;
    console.log('Started location tracking');
    return true;
  }

  // Stop location tracking
  stopTracking() {
    if (this.watchId !== null) {
      navigator.geolocation.clearWatch(this.watchId);
      this.watchId = null;
    }
    this.isTracking = false;
    console.log('Stopped location tracking');
  }

  // Handle location update
  handleLocationUpdate(position) {
    const location = [position.coords.latitude, position.coords.longitude];
    this.lastKnownLocation = location;
    this.lastLocationTime = Date.now();

    console.log('Location updated:', location, `accuracy: ${position.coords.accuracy}m`);

    if (this.callbacks.onLocationUpdate) {
      this.callbacks.onLocationUpdate(location, {
        accuracy: position.coords.accuracy,
        speed: position.coords.speed,
        heading: position.coords.heading,
        timestamp: this.lastLocationTime
      });
    }
  }

  // Handle location error
  handleLocationError(error) {
    console.error('Location error:', error);
    
    if (this.callbacks.onError) {
      this.callbacks.onError(error);
    }
  }

  // Get current location once
  async getCurrentLocation(options = {}) {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) {
        reject(new Error('Geolocation not supported'));
        return;
      }

      const defaultOptions = {
        enableHighAccuracy: true,
        timeout: 15000,
        maximumAge: 60000
      };

      const geoOptions = { ...defaultOptions, ...options };

      navigator.geolocation.getCurrentPosition(
        (position) => {
          const location = [position.coords.latitude, position.coords.longitude];
          resolve({
            location,
            accuracy: position.coords.accuracy,
            speed: position.coords.speed,
            heading: position.coords.heading,
            timestamp: Date.now()
          });
        },
        (error) => reject(error),
        geoOptions
      );
    });
  }

  // Set callback functions
  onLocationUpdate(callback) {
    this.callbacks.onLocationUpdate = callback;
  }

  onError(callback) {
    this.callbacks.onError = callback;
  }

  // Get last known location
  getLastKnownLocation() {
    return {
      location: this.lastKnownLocation,
      timestamp: this.lastLocationTime
    };
  }

  // Check if location is fresh
  isLocationFresh(maxAge = 300000) { // 5 minutes default
    return this.lastLocationTime && 
        (Date.now() - this.lastLocationTime) < maxAge;
  }
}

// Export classes for use in main app
export { GeoAlarmDB, ServiceWorkerManager, LocationManager };