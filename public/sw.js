// Enhanced Service Worker for robust background location tracking
// Place this file as 'public/sw.js' in your project

const CACHE_NAME = 'geoalarm-v2';
const DB_NAME = 'GeoAlarmDB';
const DB_VERSION = 2;

const urlsToCache = [
  '/',
  '/static/js/bundle.js',
  '/static/css/main.css',
  '/manifest.json'
];

// Global variables for tracking
let currentLocation = null;
let alarms = [];
let lastLocationUpdate = 0;
let isBackgroundSyncActive = false;

// Install service worker
self.addEventListener('install', event => {
  console.log('Service Worker installing...');
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Service Worker caching files');
        return cache.addAll(urlsToCache);
      })
  );
  // Take control immediately
  self.skipWaiting();
});

// Activate service worker
self.addEventListener('activate', event => {
  console.log('Service Worker activating...');
  event.waitUntil(
    Promise.all([
      // Clean up old caches
      caches.keys().then(cacheNames => {
        return Promise.all(
          cacheNames.map(cacheName => {
            if (cacheName !== CACHE_NAME) {
              console.log('Service Worker deleting old cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      }),
      // Take control of all clients
      self.clients.claim(),
      // Initialize background sync
      initializeBackgroundSync()
    ])
  );
});

// Fetch event - serve cached content when offline
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        return response || fetch(event.request);
      })
      .catch(() => {
        // Return a basic offline page if available
        if (event.request.destination === 'document') {
          return caches.match('/');
        }
      })
  );
});

// Enhanced background sync handler
self.addEventListener('sync', event => {
  console.log('Service Worker sync event:', event.tag);
  
  if (event.tag === 'background-location-sync') {
    event.waitUntil(handleBackgroundLocationSync());
  } else if (event.tag === 'periodic-location-check') {
    event.waitUntil(handlePeriodicLocationCheck());
  }
});

// Initialize background sync
async function initializeBackgroundSync() {
  try {
    // Load alarms from IndexedDB
    const savedAlarms = await loadAlarmsFromDB();
    if (savedAlarms.length > 0) {
      alarms = savedAlarms;
      console.log('Loaded alarms in service worker:', alarms.length);
    }

    // Set up periodic background sync if supported
    if (self.registration.sync) {
      await self.registration.sync.register('periodic-location-check');
    }

    isBackgroundSyncActive = true;
    console.log('Background sync initialized');
  } catch (error) {
    console.error('Failed to initialize background sync:', error);
  }
}

// Enhanced background location sync
async function handleBackgroundLocationSync() {
  try {
    console.log('Background location sync triggered');
    
    // Get current position with enhanced accuracy
    const position = await getCurrentPosition();
    
    if (position) {
      currentLocation = [position.coords.latitude, position.coords.longitude];
      lastLocationUpdate = Date.now();
      
      // Store location data
      await storeLocationUpdate(position);
      
      // Check for alarm triggers with enhanced logic
      await checkAlarmTriggersEnhanced(position);
      
      // Notify main app about location update
      await notifyClientsAboutLocationUpdate(currentLocation);
    }
  } catch (error) {
    console.error('Background location sync failed:', error);
    // Schedule retry after delay
    setTimeout(() => {
      if (self.registration.sync) {
        self.registration.sync.register('background-location-sync');
      }
    }, 30000); // Retry after 30 seconds
  }
}

// Handle periodic location checks (more frequent)
async function handlePeriodicLocationCheck() {
  try {
    // Only run if we have alarms and it's been a while since last update
    if (alarms.length === 0) return;
    
    const timeSinceLastUpdate = Date.now() - lastLocationUpdate;
    if (timeSinceLastUpdate < 60000) return; // Don't check more than once per minute
    
    console.log('Periodic location check triggered');
    
    const position = await getCurrentPosition();
    if (position) {
      currentLocation = [position.coords.latitude, position.coords.longitude];
      lastLocationUpdate = Date.now();
      
      await checkAlarmTriggersEnhanced(position);
      await notifyClientsAboutLocationUpdate(currentLocation);
    }
    
    // Schedule next periodic check
    setTimeout(() => {
      if (self.registration.sync) {
        self.registration.sync.register('periodic-location-check');
      }
    }, 120000); // Check every 2 minutes
    
  } catch (error) {
    console.error('Periodic location check failed:', error);
  }
}

// Enhanced geolocation with better mobile support
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }

    // Enhanced options for better mobile accuracy
    const options = {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000 // Accept cached location up to 30 seconds old
    };

    navigator.geolocation.getCurrentPosition(
      position => {
        console.log('Got position in SW:', position.coords);
        resolve(position);
      },
      error => {
        console.error('Geolocation error in SW:', error);
        // Try with less strict settings on error
        const fallbackOptions = {
          enableHighAccuracy: false,
          timeout: 30000,
          maximumAge: 300000 // Accept older cached location as fallback
        };
        
        navigator.geolocation.getCurrentPosition(
          resolve,
          reject,
          fallbackOptions
        );
      },
      options
    );
  });
}

// Store location update in IndexedDB with better error handling
async function storeLocationUpdate(position) {
  try {
    const db = await openLocationDB();
    const transaction = db.transaction(['locations'], 'readwrite');
    const store = transaction.objectStore('locations');
    
    const locationData = {
      timestamp: Date.now(),
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy,
      heading: position.coords.heading || null,
      speed: position.coords.speed || null
    };
    
    await store.add(locationData);
    console.log('Location stored in background:', locationData);
    
    // Clean up old location records (keep only last 100)
    await cleanupOldLocations(store);
    
  } catch (error) {
    console.error('Failed to store location:', error);
  }
}

// Clean up old location records
async function cleanupOldLocations(store) {
  try {
    const allRecords = await getAllRecords(store);
    if (allRecords.length > 100) {
      // Sort by timestamp and remove oldest records
      allRecords.sort((a, b) => a.timestamp - b.timestamp);
      const recordsToDelete = allRecords.slice(0, allRecords.length - 100);
      
      for (const record of recordsToDelete) {
        await store.delete(record.timestamp);
      }
    }
  } catch (error) {
    console.error('Failed to cleanup old locations:', error);
  }
}

// Enhanced IndexedDB operations
function openLocationDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    
    request.onupgradeneeded = event => {
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
        alarmsStore.createIndex('createdAt', 'createdAt', { unique: true });
      }

      // Create settings store
      if (!db.objectStoreNames.contains('settings')) {
        const settingsStore = db.createObjectStore('settings', { 
          keyPath: 'key' 
        });
      }

      // Create sync queue store for offline operations
      if (!db.objectStoreNames.contains('syncQueue')) {
        const syncStore = db.createObjectStore('syncQueue', { 
          keyPath: 'id',
          autoIncrement: true 
        });
        syncStore.createIndex('timestamp', 'timestamp', { unique: false });
      }
    };
  });
}

// Enhanced alarm trigger checking with better accuracy
async function checkAlarmTriggersEnhanced(position) {
  try {
    if (!alarms || alarms.length === 0) return;
    
    const currentLocation = [position.coords.latitude, position.coords.longitude];
    const accuracy = position.coords.accuracy || 50;
    
    console.log(`Checking ${alarms.length} alarms from location:`, currentLocation, `(accuracy: ${accuracy}m)`);
    
    for (const alarm of alarms) {
      if (!alarm.triggered && alarm.location) {
        const distance = calculateDistance(currentLocation, alarm.location);
        const effectiveRadius = alarm.radius + Math.min(accuracy, 100); // Account for GPS accuracy
        
        console.log(`Alarm "${alarm.name}": distance=${Math.round(distance)}m, radius=${alarm.radius}m, effective=${Math.round(effectiveRadius)}m`);
        
        if (distance <= effectiveRadius) {
          console.log(`Triggering alarm in background: ${alarm.name}`);
          await triggerBackgroundAlarm(alarm);
        }
      }
    }
  } catch (error) {
    console.error('Failed to check alarm triggers:', error);
  }
}

// Load alarms from IndexedDB
async function loadAlarmsFromDB() {
  try {
    const db = await openLocationDB();
    const transaction = db.transaction(['alarms'], 'readonly');
    const store = transaction.objectStore('alarms');
    const alarms = await getAllRecords(store);
    return alarms || [];
  } catch (error) {
    console.error('Failed to load alarms:', error);
    return [];
  }
}

// Get all records from an object store
function getAllRecords(store) {
  return new Promise((resolve, reject) => {
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

// Enhanced distance calculation (Haversine formula)
function calculateDistance(loc1, loc2) {
  const R = 6371e3; // Earth's radius in meters
  const φ1 = (loc1[0] * Math.PI) / 180;
  const φ2 = (loc2[0] * Math.PI) / 180;
  const Δφ = ((loc2[0] - loc1[0]) * Math.PI) / 180;
  const Δλ = ((loc2[1] - loc1[1]) * Math.PI) / 180;

  const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  
  return distance;
}

// Enhanced background alarm triggering
async function triggerBackgroundAlarm(alarm) {
  try {
    console.log('Triggering background alarm:', alarm.name);
    
    // Update alarm status in IndexedDB
    const db = await openLocationDB();
    const transaction = db.transaction(['alarms'], 'readwrite');
    const store = transaction.objectStore('alarms');
    
    const updatedAlarm = { ...alarm, triggered: true };
    await store.put(updatedAlarm);
    
    // Update local alarms array
    const alarmIndex = alarms.findIndex(a => a.createdAt === alarm.createdAt);
    if (alarmIndex !== -1) {
      alarms[alarmIndex] = updatedAlarm;
    }
    
    // Send enhanced notification
    if (self.registration && self.registration.showNotification) {
      await self.registration.showNotification('🚨 GeoAlarm Triggered!', {
        body: `You're near: ${alarm.name}`,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: `alarm-${alarm.createdAt}`,
        requireInteraction: true,
        vibrate: [200, 100, 200, 100, 200, 100, 200],
        actions: [
          {
            action: 'view',
            title: '👁️ View',
            icon: '/favicon.ico'
          },
          {
            action: 'dismiss',
            title: '✕ Dismiss',
            icon: '/favicon.ico'
          }
        ],
        data: { 
          alarmId: alarm.createdAt,
          alarmName: alarm.name,
          location: alarm.location,
          timestamp: Date.now()
        }
      });
    }
    
    // Send message to main app
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'ALARM_TRIGGERED',
        alarm: updatedAlarm
      });
    });
    
    // Add to sync queue for offline handling
    await addToSyncQueue('alarm_triggered', {
      alarmId: alarm.createdAt,
      alarmName: alarm.name,
      timestamp: Date.now(),
      location: currentLocation
    });
    
  } catch (error) {
    console.error('Failed to trigger background alarm:', error);
  }
}

// Add operation to sync queue
async function addToSyncQueue(type, data) {
  try {
    const db = await openLocationDB();
    const transaction = db.transaction(['syncQueue'], 'readwrite');
    const store = transaction.objectStore('syncQueue');
    
    await store.add({
      type,
      data,
      timestamp: Date.now(),
      processed: false
    });
  } catch (error) {
    console.error('Failed to add to sync queue:', error);
  }
}

// Notify clients about location update
async function notifyClientsAboutLocationUpdate(location) {
  try {
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'LOCATION_UPDATE',
        location,
        timestamp: Date.now()
      });
    });
  } catch (error) {
    console.error('Failed to notify clients:', error);
  }
}

// Handle notification clicks
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  const action = event.action;
  const data = event.notification.data;
  
  if (action === 'view' || !action) {
    // Open the app and focus on the triggered alarm
    event.waitUntil(
      clients.openWindow(`/?alarm=${data.alarmId}`)
    );
  }
  
  if (action === 'dismiss' && data.alarmId) {
    // Mark alarm as dismissed
    event.waitUntil(dismissAlarm(data.alarmId));
  }
});

// Dismiss alarm function
async function dismissAlarm(alarmId) {
  try {
    const db = await openLocationDB();
    const transaction = db.transaction(['alarms'], 'readwrite');
    const store = transaction.objectStore('alarms');
    
    const alarm = await store.get(alarmId);
    if (alarm) {
      alarm.triggered = false;
      alarm.dismissedAt = Date.now();
      await store.put(alarm);
      
      // Update local alarms array
      const alarmIndex = alarms.findIndex(a => a.createdAt === alarmId);
      if (alarmIndex !== -1) {
        alarms[alarmIndex] = alarm;
      }
      
      // Notify clients
      const clients = await self.clients.matchAll();
      clients.forEach(client => {
        client.postMessage({
          type: 'ALARM_DISMISSED',
          alarm
        });
      });
    }
  } catch (error) {
    console.error('Failed to dismiss alarm:', error);
  }
}

// Enhanced message handling
self.addEventListener('message', event => {
  const { type, data } = event.data;
  
  console.log('Service worker received message:', type);
  
  switch (type) {
    case 'SYNC_ALARMS':
      syncAlarmsToIndexedDB(data.alarms);
      break;
    case 'LOCATION_UPDATE':
      handleLocationUpdate(data);
      break;
    case 'REQUEST_BACKGROUND_SYNC':
      if (self.registration.sync) {
        self.registration.sync.register('background-location-sync');
      }
      break;
    case 'START_BACKGROUND_TRACKING':
      startEnhancedBackgroundTracking();
      break;
    case 'STOP_BACKGROUND_TRACKING':
      stopBackgroundTracking();
      break;
    case 'PING':
      event.ports[0].postMessage({ type: 'PONG', timestamp: Date.now() });
      break;
    default:
      console.log('Unknown message type:', type);
  }
});

// Handle location update from main app
function handleLocationUpdate(data) {
  currentLocation = data.location;
  lastLocationUpdate = data.timestamp || Date.now();
  
  // Trigger alarm check if we have alarms
  if (alarms.length > 0 && currentLocation) {
    const mockPosition = {
      coords: {
        latitude: currentLocation[0],
        longitude: currentLocation[1],
        accuracy: data.accuracy || 50
      }
    };
    checkAlarmTriggersEnhanced(mockPosition);
  }
}

// Start enhanced background tracking
function startEnhancedBackgroundTracking() {
  console.log('Starting enhanced background tracking');
  
  // Register for background sync
  if (self.registration.sync) {
    self.registration.sync.register('background-location-sync');
    self.registration.sync.register('periodic-location-check');
  }
  
  // Set up periodic wake-up (for browsers that support it)
  setInterval(() => {
    if (alarms.length > 0) {
      handlePeriodicLocationCheck();
    }
  }, 120000); // Every 2 minutes
}

// Stop background tracking
function stopBackgroundTracking() {
  console.log('Stopping background tracking');
  isBackgroundSyncActive = false;
}

// Sync alarms to IndexedDB with better error handling
async function syncAlarmsToIndexedDB(newAlarms) {
  try {
    const db = await openLocationDB();
    const transaction = db.transaction(['alarms'], 'readwrite');
    const store = transaction.objectStore('alarms');
    
    // Clear existing alarms
    await store.clear();
    
    // Add current alarms
    for (const alarm of newAlarms) {
      await store.add({
        ...alarm,
        syncedAt: Date.now()
      });
    }
    
    // Update local alarms array
    alarms = [...newAlarms];
    
    console.log('Alarms synced to IndexedDB:', alarms.length);
    
    // If we have alarms and background sync is active, start tracking
    if (alarms.length > 0 && isBackgroundSyncActive) {
      startEnhancedBackgroundTracking();
    }
    
  } catch (error) {
    console.error('Failed to sync alarms:', error);
  }
}

// Handle visibility change to maintain tracking
self.addEventListener('visibilitychange', () => {
  if (document.hidden && alarms.length > 0) {
    // App went to background, ensure sync is registered
    if (self.registration.sync) {
      self.registration.sync.register('background-location-sync');
    }
  }
});

// Periodic cleanup and maintenance
setInterval(async () => {
  try {
    // Clean up old sync queue items
    const db = await openLocationDB();
    const transaction = db.transaction(['syncQueue'], 'readwrite');
    const store = transaction.objectStore('syncQueue');
    
    const oldItems = await store.index('timestamp').getAll(
      IDBKeyRange.upperBound(Date.now() - 86400000) // 24 hours ago
    );
    
    for (const item of oldItems) {
      await store.delete(item.id);
    }
    
    console.log(`Cleaned up ${oldItems.length} old sync queue items`);
  } catch (error) {
    console.error('Periodic cleanup failed:', error);
  }
}, 3600000); // Run every hour

console.log('Enhanced GeoAlarm Service Worker loaded');