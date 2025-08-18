// Service Worker for background location tracking
// Place this file as 'public/sw.js' in your project

const CACHE_NAME = 'geoalarm-v1';
const urlsToCache = [
  '/',
  '/static/js/bundle.js',
  '/static/css/main.css'
];

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
});

// Activate service worker
self.addEventListener('activate', event => {
  console.log('Service Worker activating...');
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('Service Worker deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
});

// Fetch event - serve cached content when offline
self.addEventListener('fetch', event => {
  event.respondWith(
    caches.match(event.request)
      .then(response => {
        // Return cached version or fetch from network
        return response || fetch(event.request);
      })
  );
});

// Background sync for location updates
self.addEventListener('sync', event => {
  console.log('Service Worker sync event:', event.tag);
  
  if (event.tag === 'background-location-sync') {
    event.waitUntil(handleBackgroundLocationSync());
  }
});

// Handle background location synchronization
async function handleBackgroundLocationSync() {
  try {
    console.log('Background location sync triggered');
    
    // Get current position
    const position = await getCurrentPosition();
    
    if (position) {
      // Store location data or send to server
      await storeLocationUpdate(position);
      
      // Check for alarm triggers
      await checkAlarmTriggers(position);
    }
  } catch (error) {
    console.error('Background location sync failed:', error);
  }
}

// Get current position using Geolocation API
function getCurrentPosition() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }

    navigator.geolocation.getCurrentPosition(
      position => resolve(position),
      error => reject(error),
      {
        enableHighAccuracy: false,
        timeout: 30000,
        maximumAge: 60000
      }
    );
  });
}

// Store location update in IndexedDB
async function storeLocationUpdate(position) {
  try {
    // Open IndexedDB
    const db = await openLocationDB();
    const transaction = db.transaction(['locations'], 'readwrite');
    const store = transaction.objectStore('locations');
    
    const locationData = {
      timestamp: Date.now(),
      latitude: position.coords.latitude,
      longitude: position.coords.longitude,
      accuracy: position.coords.accuracy
    };
    
    await store.add(locationData);
    console.log('Location stored in background:', locationData);
  } catch (error) {
    console.error('Failed to store location:', error);
  }
}

// Open IndexedDB for location storage
function openLocationDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('GeoAlarmDB', 1);
    
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
          keyPath: 'id', 
          autoIncrement: true 
        });
      }
    };
  });
}

// Check for alarm triggers in background
async function checkAlarmTriggers(position) {
  try {
    const db = await openLocationDB();
    const transaction = db.transaction(['alarms'], 'readonly');
    const store = transaction.objectStore('alarms');
    const alarms = await getAllRecords(store);
    
    const currentLocation = [position.coords.latitude, position.coords.longitude];
    
    alarms.forEach(alarm => {
      if (!alarm.triggered && alarm.location) {
        const distance = calculateDistance(currentLocation, alarm.location);
        
        if (distance < alarm.radius) {
          console.log('Alarm triggered in background:', alarm.name);
          triggerBackgroundAlarm(alarm);
        }
      }
    });
  } catch (error) {
    console.error('Failed to check alarm triggers:', error);
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

// Calculate distance between two coordinates
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

// Trigger alarm in background mode
async function triggerBackgroundAlarm(alarm) {
  try {
    // Send notification
    if (self.registration && self.registration.showNotification) {
      await self.registration.showNotification('🚨 GeoAlarm Triggered!', {
        body: `You're near: ${alarm.name}`,
        icon: '/favicon.ico',
        badge: '/favicon.ico',
        tag: `alarm-${alarm.id}`,
        requireInteraction: true,
        actions: [
          {
            action: 'view',
            title: 'View Alarm'
          },
          {
            action: 'dismiss',
            title: 'Dismiss'
          }
        ],
        data: { alarmId: alarm.id }
      });
    }
    
    // Update alarm status in IndexedDB
    const db = await openLocationDB();
    const transaction = db.transaction(['alarms'], 'readwrite');
    const store = transaction.objectStore('alarms');
    
    alarm.triggered = true;
    await store.put(alarm);
    
    // Send message to main app if possible
    const clients = await self.clients.matchAll();
    clients.forEach(client => {
      client.postMessage({
        type: 'ALARM_TRIGGERED',
        alarm: alarm
      });
    });
    
  } catch (error) {
    console.error('Failed to trigger background alarm:', error);
  }
}

// Handle notification clicks
self.addEventListener('notificationclick', event => {
  event.notification.close();
  
  const action = event.action;
  const alarmId = event.notification.data?.alarmId;
  
  if (action === 'view' || !action) {
    // Open the app
    event.waitUntil(
      clients.openWindow('/')
    );
  }
  
  if (action === 'dismiss' && alarmId) {
    // Mark alarm as dismissed
    event.waitUntil(dismissAlarm(alarmId));
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
      await store.put(alarm);
    }
  } catch (error) {
    console.error('Failed to dismiss alarm:', error);
  }
}

// Handle messages from main thread
self.addEventListener('message', event => {
  const { type, data } = event.data;
  
  switch (type) {
    case 'SYNC_ALARMS':
      syncAlarmsToIndexedDB(data.alarms);
      break;
    case 'REQUEST_BACKGROUND_SYNC':
      self.registration.sync.register('background-location-sync');
      break;
    default:
      console.log('Unknown message type:', type);
  }
});

// Sync alarms to IndexedDB
async function syncAlarmsToIndexedDB(alarms) {
  try {
    const db = await openLocationDB();
    const transaction = db.transaction(['alarms'], 'readwrite');
    const store = transaction.objectStore('alarms');
    
    // Clear existing alarms
    await store.clear();
    
    // Add current alarms
    for (const alarm of alarms) {
      await store.add({
        ...alarm,
        id: alarm.createdAt // Use timestamp as ID
      });
    }
    
    console.log('Alarms synced to IndexedDB:', alarms.length);
  } catch (error) {
    console.error('Failed to sync alarms:', error);
  }
}