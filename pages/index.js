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

export default function GeoAlarmApp({ db, swManager }) {
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
    
    // Move zoom control to avoid overlap with mobile menu button
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

  // Load saved data on mount
  useEffect(() => {
    if (!db) return;
    
    const loadSavedData = async () => {
      try {
        const savedAlarms = await db.loadAlarms();
        const savedSettings = await db.loadSettings();
        
        if (savedAlarms.length > 0) {
          setAlarms(savedAlarms);
        }
        
        if (savedSettings.darkMode !== undefined) {
          setDarkMode(savedSettings.darkMode);
        }
        if (savedSettings.soundEnabled !== undefined) {
          setSoundEnabled(savedSettings.soundEnabled);
        }
      } catch (error) {
        console.error('Failed to load saved data:', error);
      }
    };
    
    loadSavedData();
  }, [db]);

  // Save alarms whenever they change
  useEffect(() => {
    if (!db || alarms.length === 0) return;
    
    const saveAlarms = async () => {
      try {
        await db.saveAlarms(alarms);
      } catch (error) {
        console.error('Failed to save alarms:', error);
      }
    };
    
    saveAlarms();
  }, [alarms, db]);

  // Save settings whenever they change
  useEffect(() => {
    if (!db) return;
    
    const saveSettings = async () => {
      try {
        await db.saveSettings({
          darkMode,
          soundEnabled,
          audioInitialized
        });
      } catch (error) {
        console.error('Failed to save settings:', error);
      }
    };
    
    saveSettings();
  }, [darkMode, soundEnabled, audioInitialized, db]);

  // Resize map when sidebar toggles (mobile) with better timing
  useEffect(() => {
    if (map) {
      const timeoutId = setTimeout(() => {
        map.invalidateSize();
        // Trigger map controls repositioning
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

  // Get user location with better accuracy
  useEffect(() => {
    if (!navigator.geolocation) return;
    if (window.innerWidth <= 768) return;

    handleRequestLocation();
  }, []);

  // Check for alarm triggers
  useEffect(() => {
    if (!userLocation || !Array.isArray(alarms) || alarms.length === 0) return;
    
    try {
      alarms.forEach((alarm, index) => {
        if (alarm && !alarm.triggered && alarm.location && Array.isArray(alarm.location)) {
          const distance = getDistance(userLocation, alarm.location);
          if (distance < (alarm.radius || 200)) {
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

  function triggerAlarm(index) {
    try {
      setAlarms(prev => prev.map((a, i) => (i === index ? { ...a, triggered: true } : a)));
      
      const alarmName = alarms[index]?.name || 'Unknown Location';
      
      if (soundEnabled) {
        playVoiceAlert(alarmName);
      }

      try {
        if (typeof window !== 'undefined' && 'Notification' in window) {
          if (Notification.permission === 'granted') {
            new Notification('🚨 Geo-Alarm Triggered!', {
              body: `You're near: ${alarmName}`,
              icon: '/favicon.ico',
              tag: `alarm-${index}`,
              requireInteraction: false
            });
          }
        }
      } catch (notificationError) {
        console.log("Notification failed:", notificationError);
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
    
    setAlarms(prev => [...prev, { 
      name, 
      location: [e.latlng.lat, e.latlng.lng], 
      radius,
      triggered: false,
      createdAt: new Date().toISOString()
    }]);
  }

  function deleteAlarm(index) {
    if (confirm("Are you sure you want to delete this alarm?")) {
      setAlarms(prev => prev.filter((_, idx) => idx !== index));
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
    
    // Move map to selected location
    if (map) {
      map.setView(location, 15);
    }
    
    // Clear search
    setSearchQuery('');
    setSearchResults([]);
    setShowSearchResults(false);
    
    // Close sidebar on mobile after selection
    if (window.innerWidth <= 768) {
      setSidebarOpen(false);
    }
    
    // Ask user if they want to create an alarm here
    setTimeout(() => {
      const createAlarm = confirm(`Create alarm at: ${display_name}?`);
      if (createAlarm) {
        const name = prompt("Enter alarm name:", display_name.split(',')[0]);
        if (name) {
          const radiusInput = prompt("Enter radius in meters (default: 200):");
          const radius = parseInt(radiusInput) || 200;
          
          setAlarms(prev => [...prev, { 
            name, 
            location,
            radius,
            triggered: false,
            createdAt: new Date().toISOString()
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

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  // Handle sidebar toggle with better mobile experience
  const handleSidebarToggle = () => {
    setSidebarOpen(!sidebarOpen);
    
    // Close search results when opening sidebar
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
              <span>{isTracking ? 'Location tracking active' : 'Location tracking disabled'}</span>
            </div>
            {!isTracking && (
              <button 
                onClick={handleRequestLocation}
                className={styles.locationBtn}
              >
                📍 Enable Location & Audio
              </button>
            )}
            
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
                      {alarm.triggered && (
                        <p className={styles.triggeredStatus}>🚨 TRIGGERED</p>
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