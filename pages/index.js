import { useEffect, useState } from "react";
import { 
  initializeAudio, 
  requestLocationAccess, 
  getDistance, 
  playVoiceAlert,
  createUserLocationIcon,
  createAlarmIcon,
  searchLocation 
} from '../util/getUtils';
import styles from '../styles/GeoAlarm.module.css';
import { GeoAlarmDB, ServiceWorkerManager, LocationManager } from '../util/db';

export default function GeoAlarmApp() {
  const [userLocation, setUserLocation] = useState([43.6532, -79.3832]); // Toronto default
  const [alarms, setAlarms] = useState([]);
  const [darkMode, setDarkMode] = useState(false);
  const [isTracking, setIsTracking] = useState(false);
  const [soundEnabled, setSoundEnabled] = useState(true);
  const [audioInitialized, setAudioInitialized] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [map, setMap] = useState(null);
  const [userMarker, setUserMarker] = useState(null);
  const [alarmMarkers, setAlarmMarkers] = useState([]);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);
  
  // Background tracking states
  const [backgroundTrackingEnabled, setBackgroundTrackingEnabled] = useState(false);
  const [locationWatchId, setLocationWatchId] = useState(null);
  const [lastLocationUpdate, setLastLocationUpdate] = useState(null);
  
  // Initialize database and managers
  const [database] = useState(() => new GeoAlarmDB());
  const [swManager] = useState(() => new ServiceWorkerManager());
  const [locationManager] = useState(() => new LocationManager());

  // Initialize map when component mounts
  useEffect(() => {
    if (typeof window === 'undefined') return;
    
    setMapReady(true);
    
    const script = document.createElement('script');
    script.src = 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js';
    script.onload = initMap;
    document.head.appendChild(script);
    
    return () => {
      if (document.head.contains(script)) {
        document.head.removeChild(script);
      }
    };
  }, []);

  const initMap = () => {
    if (!window.L || map) return;

    const mapInstance = window.L.map('map', {
      zoomControl: true,
      attributionControl: true
    }).setView(userLocation, 13);
    
    mapInstance.zoomControl.setPosition('topright');
    
    const tileLayer = darkMode 
      ? window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        })
      : window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        });
    
    tileLayer.addTo(mapInstance);
    mapInstance.on('click', handleMapClick);
    setMap(mapInstance);
  };

  // Enhanced service worker registration and messaging
  useEffect(() => {
    if ('serviceWorker' in navigator) {
      registerServiceWorker();
    }
  }, []);

  const registerServiceWorker = async () => {
    try {
      const registration = await navigator.serviceWorker.register('/sw.js');
      console.log('Service Worker registered:', registration);
      
      // Listen for messages from service worker
      navigator.serviceWorker.addEventListener('message', handleServiceWorkerMessage);
      
      // Request notification permission
      if ('Notification' in window && Notification.permission === 'default') {
        await Notification.requestPermission();
      }
      
      return registration;
    } catch (error) {
      console.error('Service Worker registration failed:', error);
    }
  };

  const handleServiceWorkerMessage = (event) => {
    const { type, alarm } = event.data;
    
    if (type === 'ALARM_TRIGGERED') {
      console.log('Alarm triggered in background:', alarm);
      // Update the alarm state to reflect the trigger
      setAlarms(prev => prev.map(a => 
        a.createdAt === alarm.id ? { ...a, triggered: true } : a
      ));
    }
  };

  // Enhanced background location tracking
  useEffect(() => {
    if (!navigator.geolocation) return;

    if (backgroundTrackingEnabled && !locationWatchId) {
      startContinuousLocationTracking();
    } else if (!backgroundTrackingEnabled && locationWatchId) {
      stopContinuousLocationTracking();
    }

    return () => {
      if (locationWatchId) {
        navigator.geolocation.clearWatch(locationWatchId);
      }
    };
  }, [backgroundTrackingEnabled]);

  const startContinuousLocationTracking = () => {
    const options = {
      enableHighAccuracy: true,
      timeout: 5000, // Reduced timeout for faster response
      maximumAge: 10000 // Reduced to 10 seconds for more frequent updates
    };

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const newLocation = [position.coords.latitude, position.coords.longitude];
        const previousLocation = userLocation;
        
        // Only update if location changed significantly (more than 5 meters)
        if (previousLocation && getDistance(previousLocation, newLocation) < 5) {
          return;
        }
        
        setUserLocation(newLocation);
        setLastLocationUpdate(Date.now());
        
        // Sync with service worker
        syncLocationWithServiceWorker(newLocation);
        
        console.log('Location updated:', newLocation, 'Accuracy:', position.coords.accuracy);
      },
      (error) => {
        console.error('Location tracking error:', error);
        // Try to get location again with lower accuracy requirements
        if (error.code === error.TIMEOUT) {
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const newLocation = [position.coords.latitude, position.coords.longitude];
              setUserLocation(newLocation);
              setLastLocationUpdate(Date.now());
            },
            () => {}, // Ignore errors on retry
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
          );
        }
      },
      options
    );

    setLocationWatchId(watchId);
    setIsTracking(true);
  };

  const stopContinuousLocationTracking = () => {
    if (locationWatchId) {
      navigator.geolocation.clearWatch(locationWatchId);
      setLocationWatchId(null);
    }
    setIsTracking(false);
  };

  const syncLocationWithServiceWorker = (location) => {
    if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: 'LOCATION_UPDATE',
        data: { location, timestamp: Date.now() }
      });
    }
  };

  // Load saved data on mount
  useEffect(() => {
    if (!database) return;
    
    const loadSavedData = async () => {
      try {
        const savedAlarms = await database.loadAlarms();
        const savedSettings = await database.loadSettings();
        
        if (savedAlarms.length > 0) {
          setAlarms(savedAlarms);
        }
        
        if (savedSettings.darkMode !== undefined) {
          setDarkMode(savedSettings.darkMode);
        }
        if (savedSettings.soundEnabled !== undefined) {
          setSoundEnabled(savedSettings.soundEnabled);
        }
        if (savedSettings.backgroundTrackingEnabled !== undefined) {
          setBackgroundTrackingEnabled(savedSettings.backgroundTrackingEnabled);
        }
      } catch (error) {
        console.error('Failed to load saved data:', error);
      }
    };
    
    loadSavedData();
  }, [database]);

  // Save alarms and sync with service worker - but avoid saving when alarms are being cleaned up
  useEffect(() => {
    if (!database || alarms.length === 0) return;
    
    const saveAlarms = async () => {
      try {
        await database.saveAlarms(alarms);
        
        // Sync alarms with service worker
        if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
          navigator.serviceWorker.controller.postMessage({
            type: 'SYNC_ALARMS',
            data: { alarms }
          });
        }
      } catch (error) {
        console.error('Failed to save alarms:', error);
      }
    };
    
    // Only auto-save if we have alarms (normal operation)
    // Manual saves are handled in delete functions
    const hasActiveAlarms = alarms.some(alarm => !alarm.triggered || alarm.type === 'persistent');
    if (hasActiveAlarms) {
      saveAlarms();
    }
  }, [alarms, database]);

  // Save settings whenever they change
  useEffect(() => {
    if (!database) return;
    
    const saveSettings = async () => {
      try {
        await database.saveSettings({
          darkMode,
          soundEnabled,
          audioInitialized,
          backgroundTrackingEnabled
        });
      } catch (error) {
        console.error('Failed to save settings:', error);
      }
    };
    
    saveSettings();
  }, [darkMode, soundEnabled, audioInitialized, backgroundTrackingEnabled, database]);

  // Resize map when sidebar toggles (mobile) with better timing
  useEffect(() => {
    if (map) {
      const timeoutId = setTimeout(() => {
        map.invalidateSize();
        map.getContainer().classList.toggle('sidebar-open', sidebarOpen);
      }, 300);
      
      return () => clearTimeout(timeoutId);
    }
  }, [sidebarOpen, map]);

  // Update tile layer when dark mode changes
  useEffect(() => {
    if (!map) return;
    
    map.eachLayer(layer => {
      if (layer._url) {
        map.removeLayer(layer);
      }
    });
    
    const tileLayer = darkMode 
      ? window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        })
      : window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        });
    
    tileLayer.addTo(map);
  }, [darkMode, map]);

  // Update user location marker
  useEffect(() => {
    if (!map || !window.L || !userLocation) return;

    if (userMarker) {
      map.removeLayer(userMarker);
    }

    const newUserMarker = window.L.marker(userLocation, {
      icon: createUserLocationIcon()
    }).addTo(map);

    newUserMarker.bindPopup('Your current location');
    setUserMarker(newUserMarker);
    map.setView(userLocation, map.getZoom());
  }, [userLocation, map]);

  // Update alarm markers
  useEffect(() => {
    if (!map || !window.L) return;

    alarmMarkers.forEach(marker => {
      map.removeLayer(marker.marker);
      map.removeLayer(marker.circle);
    });

    const newMarkers = alarms.map((alarm, i) => {
      const marker = window.L.marker(alarm.location, {
        icon: createAlarmIcon(alarm.triggered)
      }).addTo(map);

      marker.bindPopup(`
        <div>
          <strong>${alarm.name}</strong><br/>
          Radius: ${alarm.radius}m<br/>
          Status: ${alarm.triggered ? '🚨 TRIGGERED' : '✅ Active'}
        </div>
      `);

      const circle = window.L.circle(alarm.location, {
        radius: alarm.radius,
        color: alarm.triggered ? '#ef4444' : '#fbbf24',
        fillColor: alarm.triggered ? '#ef4444' : '#fbbf24',
        fillOpacity: 0.2,
        weight: 2
      }).addTo(map);

      return { marker, circle, alarm };
    });

    setAlarmMarkers(newMarkers);
  }, [alarms, map]);

  // Enhanced alarm trigger checking with better mobile support
  useEffect(() => {
    if (!userLocation || !Array.isArray(alarms) || alarms.length === 0) return;
    
    try {
      // Clean up expired alarms first
      const now = new Date();
      const activeAlarms = alarms.filter(alarm => {
        if (alarm.expiresAt && new Date(alarm.expiresAt) < now) {
          return false; // Remove expired alarm
        }
        return true;
      });
      
      // Update alarms if any were removed due to expiration
      if (activeAlarms.length !== alarms.length) {
        setAlarms(activeAlarms);
        
        // Save expired alarm cleanup to database immediately
        setTimeout(async () => {
          try {
            await database.saveAlarms(activeAlarms);
            
            // Sync with service worker
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
              navigator.serviceWorker.controller.postMessage({
                type: 'SYNC_ALARMS',
                data: { alarms: activeAlarms }
              });
            }
            
            console.log('Expired alarms cleaned from storage');
          } catch (error) {
            console.error('Failed to clean expired alarms from storage:', error);
          }
        }, 100);
        
        return; // Skip trigger checking this time, let it run again with cleaned alarms
      }
      
      activeAlarms.forEach((alarm, index) => {
        if (alarm && !alarm.triggered && alarm.location && Array.isArray(alarm.location)) {
          const distance = getDistance(userLocation, alarm.location);
          console.log(`Distance to ${alarm.name}: ${distance}m (threshold: ${alarm.radius}m)`);
          
          // Add some buffer for mobile GPS accuracy issues
          const triggerRadius = alarm.radius + 10; // Add 10m buffer
          
          if (distance <= triggerRadius) {
            console.log(`Triggering alarm: ${alarm.name}`);
            triggerAlarm(index);
          }
        }
      });
    } catch (error) {
      console.error("Error checking alarm triggers:", error);
    }
  }, [userLocation, alarms]);

  const handleInitializeAudio = async () => {
    const result = await initializeAudio(audioInitialized, soundEnabled);
    setAudioInitialized(result);
  };

  const handleRequestLocation = () => {
    requestLocationAccess(
      setIsTracking,
      setUserLocation,
      () => setIsTracking(false)
    );
  };

  const toggleBackgroundTracking = () => {
    setBackgroundTrackingEnabled(!backgroundTrackingEnabled);
  };

  function triggerAlarm(index) {
    try {
      const alarm = alarms[index];
      if (!alarm || alarm.triggered) return;
      
      setAlarms(prev => prev.map((a, i) => (i === index ? { ...a, triggered: true } : a)));
      
      const alarmName = alarm.name || 'Unknown Location';
      
      if (soundEnabled && audioInitialized) {
        playVoiceAlert(alarmName);
      }

      // Enhanced notification with better mobile support
      try {
        if (typeof window !== 'undefined' && 'Notification' in window) {
          if (Notification.permission === 'granted') {
            const notification = new Notification('🚨 Geo-Alarm Triggered!', {
              body: `You're near: ${alarmName}`,
              icon: '/favicon.ico',
              tag: `alarm-${index}`,
              requireInteraction: true,
              vibrate: [200, 100, 200, 100, 200], // Vibration pattern for mobile
              silent: false
            });

            // Auto-close notification after 10 seconds
            setTimeout(() => notification.close(), 10000);
          }
        }
      } catch (notificationError) {
        console.log("Notification failed:", notificationError);
      }

      // Vibration for mobile devices
      if ('vibrator' in navigator || 'vibrate' in navigator) {
        navigator.vibrate([200, 100, 200, 100, 200]);
      }

      // Auto-delete one-time alarms after 3 seconds
      if (alarm.type === 'oneTime') {
        setTimeout(async () => {
          const newAlarms = alarms.filter((_, i) => i !== index);
          setAlarms(newAlarms);
          
          // Immediately save to database and sync with service worker
          try {
            await database.saveAlarms(newAlarms);
            
            // Sync with service worker
            if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
              navigator.serviceWorker.controller.postMessage({
                type: 'SYNC_ALARMS',
                data: { alarms: newAlarms }
              });
            }
            
            console.log('One-time alarm deleted from storage:', alarmName);
          } catch (error) {
            console.error('Failed to delete alarm from storage:', error);
          }
        }, 3000);
      }

    } catch (error) {
      console.error("Error in triggerAlarm:", error);
    }
  }

  function handleMapClick(e) {
    const name = prompt("Enter alarm name:");
    if (!name) return;
    
    const radiusInput = prompt("Enter radius in meters (default: 200):");
    const radius = parseInt(radiusInput) || 200;
    
    // Ask for alarm type
    const alarmType = confirm("One-time use alarm? (OK = Yes, Cancel = Persistent)") ? 'oneTime' : 'persistent';
    
    // Ask for auto-expire time if persistent
    let expiresAt = null;
    if (alarmType === 'persistent') {
      const hours = prompt("Auto-delete after how many hours? (default: never, enter 0 for never):");
      const hoursNum = parseInt(hours);
      if (hoursNum && hoursNum > 0) {
        expiresAt = new Date(Date.now() + (hoursNum * 60 * 60 * 1000)).toISOString();
      }
    }
    
    setAlarms(prev => [...prev, { 
      name, 
      location: [e.latlng.lat, e.latlng.lng], 
      radius,
      triggered: false,
      createdAt: new Date().toISOString(),
      type: alarmType,
      expiresAt: expiresAt
    }]);
  }

  function deleteAlarm(index) {
    if (confirm("Are you sure you want to delete this alarm?")) {
      const newAlarms = alarms.filter((_, idx) => idx !== index);
      setAlarms(newAlarms);
      
      // Immediately save to database and sync with service worker
      setTimeout(async () => {
        try {
          await database.saveAlarms(newAlarms);
          
          // Sync with service worker
          if ('serviceWorker' in navigator && navigator.serviceWorker.controller) {
            navigator.serviceWorker.controller.postMessage({
              type: 'SYNC_ALARMS',
              data: { alarms: newAlarms }
            });
          }
          
          console.log('Alarm deleted from storage');
        } catch (error) {
          console.error('Failed to delete alarm from storage:', error);
        }
      }, 100);
    }
  }

  function resetAlarm(index) {
    setAlarms(prev => prev.map((a, i) => (i === index ? { ...a, triggered: false } : a)));
  }

  // Search functionality
  const handleSearch = async (e) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setIsSearching(true);
    try {
      const results = await searchLocation(searchQuery);
      setSearchResults(results);
      setShowSearchResults(true);
    } catch (error) {
      console.error('Search failed:', error);
      alert('Search failed. Please try again.');
    } finally {
      setIsSearching(false);
    }
  };

  const selectSearchResult = (result) => {
    const { lat, lon, display_name } = result;
    const location = [parseFloat(lat), parseFloat(lon)];
    
    if (map) {
      map.setView(location, 15);
    }
    
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(false);
    
    if (window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
    
    setTimeout(() => {
      const createAlarm = confirm(`Create alarm at: ${display_name}?`);
      if (createAlarm) {
        const name = prompt("Enter alarm name:", display_name.split(',')[0]);
        if (name) {
          const radiusInput = prompt("Enter radius in meters (default: 200):");
          const radius = parseInt(radiusInput) || 200;
          
          // Ask for alarm type
          const alarmType = confirm("One-time use alarm? (OK = Yes, Cancel = Persistent)") ? 'oneTime' : 'persistent';
          
          // Ask for auto-expire time if persistent
          let expiresAt = null;
          if (alarmType === 'persistent') {
            const hours = prompt("Auto-delete after how many hours? (default: never, enter 0 for never):");
            const hoursNum = parseInt(hours);
            if (hoursNum && hoursNum > 0) {
              expiresAt = new Date(Date.now() + (hoursNum * 60 * 60 * 1000)).toISOString();
            }
          }
          
          setAlarms(prev => [...prev, { 
            name, 
            location,
            radius,
            triggered: false,
            createdAt: new Date().toISOString(),
            type: alarmType,
            expiresAt: expiresAt
          }]);
        }
      }
    }, 500);
  };

  const clearSearch = () => {
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(false);
  };

  const handleSidebarToggle = () => {
    setSidebarOpen(!sidebarOpen);
    
    if (!sidebarOpen) {
      setShowSearchResults(false);
    }
  };

  const handleSidebarClose = () => {
    setSidebarOpen(false);
    setShowSearchResults(false);
  };

  return (
    <>
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
        crossOrigin=""
      />

      <div className={`${styles.appContainer} ${darkMode ? styles.dark : ''}`}>
        {/* Mobile Menu Button */}
        <button 
          className={styles.mobileMenuBtn}
          onClick={handleSidebarToggle}
          aria-label="Toggle menu"
        >
          <span className={`${styles.hamburger} ${sidebarOpen ? styles.open : ''}`}>
            <span></span>
            <span></span>
            <span></span>
          </span>
        </button>

        {/* Sidebar Overlay (Mobile) */}
        {sidebarOpen && <div className={styles.sidebarOverlay} onClick={handleSidebarClose} />}

        {/* Sidebar */}
        <div className={`${styles.sidebar} ${sidebarOpen ? styles.open : ''}`}>
          {/* Mobile Close Button */}
          <button 
            className={styles.mobileCloseBtn}
            onClick={handleSidebarClose}
            aria-label="Close menu"
          >
            ✕
          </button>

          {/* Header */}
          <div className={styles.sidebarHeader}>
            <div className={styles.appTitle}>
              <span className={styles.titleIcon}>🧭</span>
              <h1>GeoAlarm</h1>
            </div>
            <div className={styles.headerControls}>
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`${styles.controlBtn} ${soundEnabled ? styles.active : ''}`}
                title="Toggle Sound"
              >
                🔊
              </button>
              <button
                onClick={() => setDarkMode(!darkMode)}
                className={styles.controlBtn}
                title="Toggle Theme"
              >
                {darkMode ? '☀️' : '🌙'}
              </button>
            </div>
          </div>

          {/* Search Section */}
          <div className={styles.searchSection}>
            <form onSubmit={handleSearch} className={styles.searchForm}>
              <div className={styles.searchInputWrapper}>
                <input
                  type="text"
                  placeholder="Search for places, addresses..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className={styles.searchInput}
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={clearSearch}
                    className={styles.clearSearchBtn}
                  >
                    ✕
                  </button>
                )}
                <button
                  type="submit"
                  disabled={isSearching || !searchQuery.trim()}
                  className={styles.searchBtn}
                >
                  {isSearching ? '🔄' : '🔍'}
                </button>
              </div>
            </form>
            
            {/* Search Results */}
            {showSearchResults && (
              <div className={styles.searchResults}>
                {searchResults.length > 0 ? (
                  <>
                    <div className={styles.searchResultsHeader}>
                      <span>Search Results</span>
                      <button 
                        onClick={() => setShowSearchResults(false)}
                        className={styles.closeResultsBtn}
                      >
                        ✕
                      </button>
                    </div>
                    <div className={styles.searchResultsList}>
                      {searchResults.map((result, index) => (
                        <div
                          key={index}
                          onClick={() => selectSearchResult(result)}
                          className={styles.searchResultItem}
                        >
                          <div className={styles.searchResultIcon}>📍</div>
                          <div className={styles.searchResultText}>
                            <div className={styles.searchResultName}>
                              {result.display_name.split(',')[0]}
                            </div>
                            <div className={styles.searchResultAddress}>
                              {result.display_name}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                ) : (
                  <div className={styles.noResults}>
                    <div>No results found</div>
                    <small>Try a different search term</small>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Status */}
          <div className={styles.statusSection}>
            <div className={`${styles.statusIndicator} ${isTracking ? styles.active : styles.inactive}`}>
              <div className={styles.statusDot}></div>
              <span>
                {isTracking ? 'Location tracking active' : 'Location tracking disabled'}
                {lastLocationUpdate && (
                  <small> • Last update: {new Date(lastLocationUpdate).toLocaleTimeString()}</small>
                )}
              </span>
            </div>
            
            {!isTracking && (
              <button 
                onClick={handleRequestLocation}
                className={styles.locationBtn}
              >
                📍 Enable Location
              </button>
            )}

            {/* Background tracking toggle */}
            <div className={styles.backgroundTrackingSection}>
              <label className={styles.toggleLabel}>
                <input
                  type="checkbox"
                  checked={backgroundTrackingEnabled}
                  onChange={toggleBackgroundTracking}
                  className={styles.toggleInput}
                />
                <span className={styles.toggleSlider}></span>
                <span>Continuous background tracking</span>
              </label>
              <small>Keep tracking even when app is in background</small>
            </div>
            
            {!audioInitialized && isTracking && soundEnabled && (
              <button 
                onClick={handleInitializeAudio}
                className={styles.audioBtn}
              >
                🔊 Enable Sound Alerts
              </button>
            )}
          </div>

          {/* Alarms */}
          <div className={styles.alarmsSection}>
            <h2 className={styles.sectionTitle}>
              🔔 My Alarms ({alarms.length})
            </h2>

            {alarms.length === 0 && (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>📍</div>
                <p>No alarms set</p>
                <small>Click on the map to create one</small>
              </div>
            )}

            <div className={styles.alarmsList}>
              {alarms.map((alarm, i) => (
                <div key={i} className={`${styles.alarmCard} ${alarm.triggered ? styles.triggered : ''}`}>
                  <div className={styles.alarmInfo}>
                    <div className={styles.alarmHeader}>
                      <span className={`${styles.alarmBell} ${alarm.triggered ? styles.triggered : ''}`}>
                        {alarm.triggered ? '🚨' : '🔔'}
                      </span>
                      <h3>{alarm.name}</h3>
                    </div>
                    <div className={styles.alarmDetails}>
                      <p>Radius: {alarm.radius}m</p>
                      <p className={styles.coordinates}>
                        {alarm.location[0].toFixed(4)}, {alarm.location[1].toFixed(4)}
                      </p>
                      <p className={`${styles.alarmType} ${alarm.type === 'oneTime' ? styles.oneTime : styles.persistent}`}>
                        {alarm.type === 'oneTime' ? '🔄 One-time use' : '🔁 Persistent'}
                      </p>
                      {alarm.expiresAt && (
                        <p className={styles.expiresAt}>
                          ⏰ Expires: {new Date(alarm.expiresAt).toLocaleString()}
                        </p>
                      )}
                      {alarm.triggered && (
                        <p className={styles.triggeredStatus}>🚨 TRIGGERED</p>
                      )}
                      {userLocation && (
                        <p className={styles.distance}>
                          Distance: {Math.round(getDistance(userLocation, alarm.location))}m
                        </p>
                      )}
                    </div>
                  </div>
                  
                  <div className={styles.alarmActions}>
                    {alarm.triggered && (
                      <button
                        onClick={() => resetAlarm(i)}
                        className={styles.resetBtn}
                      >
                        Reset
                      </button>
                    )}
                    <button
                      onClick={() => deleteAlarm(i)}
                      className={styles.deleteBtn}
                      title="Delete alarm"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Footer */}
          <div className={styles.sidebarFooter}>
            <div className={styles.legend}>
              <div className={styles.legendItem}>
                <div className={`${styles.legendDot} ${styles.userLocation}`}></div>
                <span>Your location</span>
              </div>
              <div className={styles.legendItem}>
                <div className={`${styles.legendDot} ${styles.alarmLocation}`}></div>
                <span>Alarm location</span>
              </div>
            </div>
            <p>Click anywhere on the map to create a new geo-alarm, or use search to find locations</p>
          </div>
        </div>

        {/* Map Container */}
        <div className={styles.mapContainer}>
          <div id="map" style={{ height: "100%", width: "100%" }}></div>
          
          {!mapReady && (
            <div className={styles.mapLoading}>
              <div className={styles.loadingSpinner}></div>
              <p>Loading map...</p>
            </div>
            )}
        </div>
      </div>
    </>
  );
}