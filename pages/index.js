import { useEffect, useState } from "react";

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
  const [sidebarOpen, setSidebarOpen] = useState(false); // Mobile sidebar toggle

  // Initialize map when component mounts
  useEffect(() => {
    // Check if we're in browser environment
    if (typeof window === 'undefined') return;
    
    setMapReady(true);
    
    // Load Leaflet dynamically
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

  // Initialize the Leaflet map
  const initMap = () => {
    if (!window.L || map) return;

    const mapInstance = window.L.map('map').setView(userLocation, 13);
    
    // Add tile layer
    const tileLayer = darkMode 
      ? window.L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>'
        })
      : window.L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        });
    
    tileLayer.addTo(mapInstance);
    
    // Handle map clicks
    mapInstance.on('click', handleMapClick);
    
    setMap(mapInstance);
  };

  // Resize map when sidebar toggles (mobile)
  useEffect(() => {
    if (map) {
      setTimeout(() => {
        map.invalidateSize();
      }, 300); // Wait for animation to complete
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

  // Create custom blue dot icon for user location
  const createUserLocationIcon = () => {
    if (!window.L) return null;
    
    return window.L.divIcon({
      className: 'user-location-marker',
      html: `
        <div class="user-location-dot">
          <div class="user-location-pulse"></div>
          <div class="user-location-inner"></div>
        </div>
      `,
      iconSize: [20, 20],
      iconAnchor: [10, 10]
    });
  };

  // Create custom red dot icon for alarm locations
  const createAlarmIcon = (triggered = false) => {
    if (!window.L) return null;
    
    return window.L.divIcon({
      className: 'alarm-location-marker',
      html: `
        <div class="alarm-location-dot ${triggered ? 'triggered' : ''}">
          <div class="alarm-location-inner"></div>
        </div>
      `,
      iconSize: [16, 16],
      iconAnchor: [8, 8]
    });
  };

  // Update user location marker
  useEffect(() => {
    if (!map || !window.L || !userLocation) return;

    // Remove existing user marker
    if (userMarker) {
      map.removeLayer(userMarker);
    }

    // Add new user marker with blue dot
    const newUserMarker = window.L.marker(userLocation, {
      icon: createUserLocationIcon()
    }).addTo(map);

    // Add popup
    newUserMarker.bindPopup('Your current location');
    
    setUserMarker(newUserMarker);
    
    // Center map on user location
    map.setView(userLocation, map.getZoom());
  }, [userLocation, map]);

  // Update alarm markers
  useEffect(() => {
    if (!map || !window.L) return;

    // Remove existing alarm markers
    alarmMarkers.forEach(marker => {
      map.removeLayer(marker.marker);
      map.removeLayer(marker.circle);
    });

    // Add new alarm markers
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

    // Don't auto-request location on mobile - wait for user interaction
    if (window.innerWidth <= 768) return;

    requestLocationAccess();
  }, []);

  // Initialize audio on first user interaction (mobile requirement)
  const initializeAudio = async () => {
    if (audioInitialized || !soundEnabled) return;
    
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        const audioContext = new AudioContextClass();
        if (audioContext.state === 'suspended') {
          await audioContext.resume();
        }
        
        // Test voice synthesis
        if ('speechSynthesis' in window) {
          const testUtterance = new SpeechSynthesisUtterance('');
          testUtterance.volume = 0.01;
          speechSynthesis.speak(testUtterance);
        }
        
        setAudioInitialized(true);
        console.log('Audio initialized successfully');
      }
    } catch (error) {
      console.log('Audio initialization failed:', error);
    }
  };

  // Request location access function
  const requestLocationAccess = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by this browser');
      return;
    }

    setIsTracking(true);
    
    const options = {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 30000
    };

    const successCallback = (position) => {
      try {
        if (position && position.coords) {
          const newLocation = [position.coords.latitude, position.coords.longitude];
          setUserLocation(newLocation);
          setIsTracking(true);
        }
      } catch (error) {
        console.error("Error processing location:", error);
        setIsTracking(false);
      }
    };

    const errorCallback = (error) => {
      console.error("Geolocation error:", error);
      setIsTracking(false);
      
      // Show user-friendly error messages
      let errorMessage = "Unable to get your location. ";
      try {
        switch(error.code) {
          case 1: // PERMISSION_DENIED
            errorMessage += "Please enable location access in your browser settings.";
            break;
          case 2: // POSITION_UNAVAILABLE
            errorMessage += "Location information is unavailable.";
            break;
          case 3: // TIMEOUT
            errorMessage += "Location request timed out.";
            break;
          default:
            errorMessage += "An unknown error occurred.";
        }
        alert(errorMessage);
      } catch (alertError) {
        console.error("Error showing location error message:", alertError);
      }
    };

    try {
      const watchId = navigator.geolocation.watchPosition(
        successCallback,
        errorCallback,
        options
      );

      // Store watchId for cleanup
      return () => {
        if (watchId) navigator.geolocation.clearWatch(watchId);
      };
    } catch (error) {
      console.error("Error setting up geolocation watch:", error);
      setIsTracking(false);
    }
  };

  // Check for alarm triggers with better error handling
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

  function triggerAlarm(index) {
    try {
      // Update alarm state first
      setAlarms(prev => prev.map((a, i) => (i === index ? { ...a, triggered: true } : a)));
      
      // Get alarm name safely
      const alarmName = alarms[index]?.name || 'Unknown Location';
      
      // Play voice alert instead of popup
      if (soundEnabled) {
        playVoiceAlert(alarmName);
      }

      // Show notification (but no popup alert)
      try {
        if (typeof window !== 'undefined' && 'Notification' in window) {
          if (Notification.permission === 'granted') {
            new Notification('🚨 Geo-Alarm Triggered!', {
              body: `You're near: ${alarmName}`,
              icon: '/favicon.ico',
              tag: `alarm-${index}`,
              requireInteraction: false // Don't require user to dismiss
            });
          }
        }
      } catch (notificationError) {
        console.log("Notification failed:", notificationError);
      }

      // NO POPUP ALERT - Only voice and visual feedback

    } catch (error) {
      console.error("Error in triggerAlarm:", error);
    }
  }

  // New function for voice alerts
  function playVoiceAlert(alarmName) {
    try {
      // Method 1: Speech Synthesis (works best on mobile)
      if ('speechSynthesis' in window) {
        // Stop any ongoing speech
        speechSynthesis.cancel();
        
        // Play voice alert 3 times
        for (let i = 0; i < 3; i++) {
          setTimeout(() => {
            const utterance = new SpeechSynthesisUtterance(`Alarm triggered. You have reached ${alarmName}`);
            utterance.rate = 1.2;
            utterance.volume = 1.0;
            utterance.pitch = 1.0;
            speechSynthesis.speak(utterance);
          }, i * 2000); // 2 second delay between each announcement
        }
      }
      
      // Method 2: Backup sound (beeps)
      setTimeout(() => {
        playBackupSound();
      }, 500);
      
    } catch (error) {
      console.log("Voice alert failed:", error);
      playBackupSound();
    }
  }

  // Backup sound method
  function playBackupSound() {
    try {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (AudioContextClass) {
        const audioContext = new AudioContextClass();
        
        if (audioContext.state === 'suspended') {
          audioContext.resume().then(() => {
            playBeepSequence(audioContext);
          });
        } else {
          playBeepSequence(audioContext);
        }
      }
    } catch (error) {
      console.log("Backup sound failed:", error);
    }
  }

  function playBeepSequence(audioContext) {
    try {
      // Play 3 urgent beeps
      for (let i = 0; i < 3; i++) {
        const startTime = audioContext.currentTime + (i * 0.6);
        
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();
        
        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);
        
        // Higher frequency for urgency
        oscillator.frequency.setValueAtTime(1200, startTime);
        gainNode.gain.setValueAtTime(0.5, startTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.4);
        
        oscillator.start(startTime);
        oscillator.stop(startTime + 0.4);
      }
    } catch (error) {
      console.log("Beep sequence failed:", error);
    }
  }

  function getDistance(loc1, loc2) {
    try {
      if (!loc1 || !loc2 || !Array.isArray(loc1) || !Array.isArray(loc2)) {
        console.warn("Invalid locations for distance calculation");
        return Infinity; // Return large distance to avoid false triggers
      }

      const R = 6371e3; // Earth's radius in meters
      const φ1 = (loc1[0] * Math.PI) / 180;
      const φ2 = (loc2[0] * Math.PI) / 180;
      const Δφ = ((loc2[0] - loc1[0]) * Math.PI) / 180;
      const Δλ = ((loc2[1] - loc1[1]) * Math.PI) / 180;

      const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
      const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
      
      return isNaN(distance) ? Infinity : distance;
    } catch (error) {
      console.error("Error calculating distance:", error);
      return Infinity;
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

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  return (
    <>
      {/* Import Leaflet CSS */}
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
        crossOrigin=""
      />

      <div className={`app-container ${darkMode ? 'dark' : ''}`}>
        {/* Mobile Menu Button */}
        <button 
          className="mobile-menu-btn"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label="Toggle menu"
        >
          <span className={`hamburger ${sidebarOpen ? 'open' : ''}`}>
            <span></span>
            <span></span>
            <span></span>
          </span>
        </button>

        {/* Sidebar Overlay (Mobile) */}
        {sidebarOpen && <div className="sidebar-overlay" onClick={() => setSidebarOpen(false)} />}

        {/* Sidebar */}
        <div className={`sidebar ${sidebarOpen ? 'open' : ''}`}>
          {/* Mobile Close Button */}
          <button 
            className="mobile-close-btn"
            onClick={() => setSidebarOpen(false)}
            aria-label="Close menu"
          >
            ✕
          </button>

          {/* Header */}
          <div className="sidebar-header">
            <div className="app-title">
              <span className="title-icon">🧭</span>
              <h1>GeoAlarm</h1>
            </div>
            <div className="header-controls">
              <button
                onClick={() => setSoundEnabled(!soundEnabled)}
                className={`control-btn ${soundEnabled ? 'active' : ''}`}
                title="Toggle Sound"
              >
                🔊
              </button>
              <button
                onClick={() => setDarkMode(!darkMode)}
                className="control-btn"
                title="Toggle Theme"
              >
                {darkMode ? '☀️' : '🌙'}
              </button>
            </div>
          </div>

          {/* Status */}
          <div className="status-section">
            <div className={`status-indicator ${isTracking ? 'active' : 'inactive'}`}>
              <div className="status-dot"></div>
              <span>{isTracking ? 'Location tracking active' : 'Location tracking disabled'}</span>
            </div>
            {!isTracking && (
              <button 
                onClick={requestLocationAccess}
                className="location-btn"
              >
                📍 Enable Location & Audio
              </button>
            )}
            
            {!audioInitialized && isTracking && soundEnabled && (
              <button 
                onClick={initializeAudio}
                className="audio-btn"
              >
                🔊 Enable Sound Alerts
              </button>
            )}
          </div>

          {/* Alarms */}
          <div className="alarms-section">
            <h2 className="section-title">
              🔔 My Alarms ({alarms.length})
            </h2>

            {alarms.length === 0 && (
              <div className="empty-state">
                <div className="empty-icon">📍</div>
                <p>No alarms set</p>
                <small>Click on the map to create one</small>
              </div>
            )}

            <div className="alarms-list">
              {alarms.map((alarm, i) => (
                <div key={i} className={`alarm-card ${alarm.triggered ? 'triggered' : ''}`}>
                  <div className="alarm-info">
                    <div className="alarm-header">
                      <span className={`alarm-bell ${alarm.triggered ? 'triggered' : ''}`}>
                        {alarm.triggered ? '🚨' : '🔔'}
                      </span>
                      <h3>{alarm.name}</h3>
                    </div>
                    <div className="alarm-details">
                      <p>Radius: {alarm.radius}m</p>
                      <p className="coordinates">
                        {alarm.location[0].toFixed(4)}, {alarm.location[1].toFixed(4)}
                      </p>
                      {alarm.triggered && (
                        <p className="triggered-status">🚨 TRIGGERED</p>
                      )}
                    </div>
                  </div>
                  
                  <div className="alarm-actions">
                    {alarm.triggered && (
                      <button
                        onClick={() => resetAlarm(i)}
                        className="reset-btn"
                      >
                        Reset
                      </button>
                    )}
                    <button
                      onClick={() => deleteAlarm(i)}
                      className="delete-btn"
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
          <div className="sidebar-footer">
            <div className="legend">
              <div className="legend-item">
                <div className="legend-dot user-location"></div>
                <span>Your location</span>
              </div>
              <div className="legend-item">
                <div className="legend-dot alarm-location"></div>
                <span>Alarm location</span>
              </div>
            </div>
            <p>Click anywhere on the map to create a new geo-alarm</p>
          </div>
        </div>

        {/* Map Container */}
        <div className="map-container">
          <div id="map" style={{ height: "100%", width: "100%" }}></div>
          
          {!mapReady && (
            <div className="map-loading">
              <div className="loading-spinner"></div>
              <p>Loading map...</p>
            </div>
          )}
        </div>

        <style jsx>{`
          .app-container {
            display: flex;
            height: 100vh;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f8fafc;
            color: #1e293b;
            position: relative;
          }

          .app-container.dark {
            background: #0f172a;
            color: #f1f5f9;
          }

          /* Mobile Menu Button */
          .mobile-menu-btn {
            position: fixed;
            top: 16px;
            left: 16px;
            z-index: 1001;
            width: 48px;
            height: 48px;
            border: none;
            border-radius: 12px;
            background: rgba(255, 255, 255, 0.95);
            backdrop-filter: blur(10px);
            box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
            cursor: pointer;
            display: none;
            align-items: center;
            justify-content: center;
            transition: all 0.2s ease;
          }

          .dark .mobile-menu-btn {
            background: rgba(30, 41, 59, 0.95);
            color: #f1f5f9;
          }

          .mobile-menu-btn:hover {
            transform: scale(1.05);
          }

          /* Hamburger Icon */
          .hamburger {
            position: relative;
            width: 20px;
            height: 14px;
            display: flex;
            flex-direction: column;
            justify-content: space-between;
          }

          .hamburger span {
            display: block;
            height: 2px;
            width: 100%;
            background: currentColor;
            border-radius: 1px;
            transition: all 0.3s ease;
            transform-origin: center;
          }

          .hamburger.open span:nth-child(1) {
            transform: translateY(6px) rotate(45deg);
          }

          .hamburger.open span:nth-child(2) {
            opacity: 0;
          }

          .hamburger.open span:nth-child(3) {
            transform: translateY(-6px) rotate(-45deg);
          }

          /* Mobile Close Button */
          .mobile-close-btn {
            position: absolute;
            top: 16px;
            right: 16px;
            z-index: 1002;
            width: 32px;
            height: 32px;
            border: none;
            border-radius: 50%;
            background: rgba(0, 0, 0, 0.1);
            cursor: pointer;
            display: none;
            align-items: center;
            justify-content: center;
            font-size: 18px;
            transition: all 0.2s;
          }

          .mobile-close-btn:hover {
            background: rgba(0, 0, 0, 0.2);
          }

          .dark .mobile-close-btn {
            background: rgba(255, 255, 255, 0.1);
            color: #f1f5f9;
          }

          .dark .mobile-close-btn:hover {
            background: rgba(255, 255, 255, 0.2);
          }

          /* Sidebar Overlay */
          .sidebar-overlay {
            position: fixed;
            top: 0;
            left: 0;
            right: 0;
            bottom: 0;
            background: rgba(0, 0, 0, 0.5);
            z-index: 999;
            display: none;
          }

          .sidebar {
            width: 320px;
            background: white;
            border-right: 1px solid #e2e8f0;
            display: flex;
            flex-direction: column;
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
            position: relative;
            z-index: 1000;
            transition: transform 0.3s ease;
          }

          .dark .sidebar {
            background: #1e293b;
            border-color: #334155;
          }

          .sidebar-header {
            padding: 24px;
            border-bottom: 1px solid #e2e8f0;
            display: flex;
            align-items: center;
            justify-content: space-between;
          }

          .dark .sidebar-header {
            border-color: #334155;
          }

          .app-title {
            display: flex;
            align-items: center;
            gap: 12px;
          }

          .app-title h1 {
            font-size: 24px;
            font-weight: 700;
            margin: 0;
          }

          .title-icon {
            font-size: 28px;
          }

          .header-controls {
            display: flex;
            gap: 8px;
          }

          .control-btn {
            padding: 8px 12px;
            border: none;
            border-radius: 8px;
            background: #f1f5f9;
            cursor: pointer;
            font-size: 16px;
            transition: all 0.2s;
          }

          .control-btn:hover {
            background: #e2e8f0;
          }

          .dark .control-btn {
            background: #374151;
          }

          .dark .control-btn:hover {
            background: #4b5563;
          }

          .control-btn.active {
            background: #3b82f6;
            color: white;
          }

          .status-section {
            padding: 16px 24px;
            border-bottom: 1px solid #e2e8f0;
          }

          .dark .status-section {
            border-color: #334155;
          }

          .location-btn {
            margin-top: 12px;
            width: 100%;
            padding: 8px 16px;
            border: none;
            border-radius: 8px;
            background: #3b82f6;
            color: white;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.2s;
          }

          .location-btn:hover {
            background: #2563eb;
          }

          .audio-btn {
            margin-top: 8px;
            width: 100%;
            padding: 8px 16px;
            border: none;
            border-radius: 8px;
            background: #f59e0b;
            color: white;
            font-size: 14px;
            font-weight: 500;
            cursor: pointer;
            transition: background 0.2s;
          }

          .audio-btn:hover {
            background: #d97706;
          }

          .status-indicator {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 14px;
          }

          .status-dot {
            width: 8px;
            height: 8px;
            border-radius: 50%;
            background: #ef4444;
          }

          .status-indicator.active .status-dot {
            background: #10b981;
            animation: pulse 2s infinite;
          }

          @keyframes pulse {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }

          .alarms-section {
            flex: 1;
            padding: 24px;
            overflow-y: auto;
          }

          .section-title {
            font-size: 18px;
            font-weight: 600;
            margin: 0 0 16px 0;
          }

          .empty-state {
            text-align: center;
            padding: 32px 16px;
            color: #64748b;
          }

          .dark .empty-state {
            color: #94a3b8;
          }

          .empty-icon {
            font-size: 48px;
            margin-bottom: 12px;
          }

          .empty-state p {
            margin: 0 0 4px 0;
            font-size: 14px;
          }

          .empty-state small {
            font-size: 12px;
            opacity: 0.7;
          }

          .alarms-list {
            display: flex;
            flex-direction: column;
            gap: 12px;
          }

          .alarm-card {
            padding: 16px;
            border-radius: 12px;
            border: 1px solid #e2e8f0;
            background: white;
            box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
            transition: all 0.2s;
          }

          .alarm-card:hover {
            box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
          }

          .dark .alarm-card {
            border-color: #374151;
            background: #374151;
          }

          .alarm-card.triggered {
            border-color: #ef4444;
            background: #fef2f2;
            animation: triggerPulse 2s infinite;
          }

          .dark .alarm-card.triggered {
            background: rgba(239, 68, 68, 0.1);
          }

          @keyframes triggerPulse {
            0%, 100% { transform: scale(1); }
            50% { transform: scale(1.02); }
          }

          .alarm-header {
            display: flex;
            align-items: center;
            gap: 8px;
            margin-bottom: 8px;
          }

          .alarm-bell {
            font-size: 16px;
          }

          .alarm-header h3 {
            margin: 0;
            font-size: 16px;
            font-weight: 500;
            flex: 1;
          }

          .alarm-details {
            font-size: 13px;
            color: #64748b;
            line-height: 1.4;
          }

          .dark .alarm-details {
            color: #94a3b8;
          }

          .alarm-details p {
            margin: 2px 0;
          }

          .coordinates {
            font-family: monospace;
            font-size: 11px;
          }

          .triggered-status {
            color: #ef4444;
            font-weight: 600;
            font-size: 12px;
            animation: blink 1s infinite;
          }

          @keyframes blink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }

          .alarm-actions {
            display: flex;
            gap: 8px;
            margin-top: 12px;
            justify-content: flex-end;
          }

          .reset-btn {
            padding: 4px 12px;
            border: none;
            border-radius: 6px;
            background: #3b82f6;
            color: white;
            font-size: 12px;
            cursor: pointer;
            transition: background 0.2s;
          }

          .reset-btn:hover {
            background: #2563eb;
          }

          .delete-btn {
            padding: 6px;
            border: none;
            border-radius: 6px;
            background: transparent;
            cursor: pointer;
            font-size: 16px;
            transition: background 0.2s;
          }

          .delete-btn:hover {
            background: rgba(239, 68, 68, 0.1);
          }

          .sidebar-footer {
            padding: 16px 24px;
            border-top: 1px solid #e2e8f0;
            font-size: 12px;
            color: #64748b;
            text-align: center;
            line-height: 1.4;
          }

          .dark .sidebar-footer {
            border-color: #334155;
            color: #94a3b8;
          }

          .legend {
            display: flex;
            flex-direction: column;
            gap: 8px;
            margin-bottom: 12px;
          }

          .legend-item {
            display: flex;
            align-items: center;
            gap: 8px;
            font-size: 11px;
          }

          .legend-dot {
            width: 10px;
            height: 10px;
            border-radius: 50%;
          }

          .legend-dot.user-location {
            background: #3b82f6;
            border: 2px solid white;
            box-shadow: 0 0 0 1px #3b82f6;
          }

          .legend-dot.alarm-location {
            background: #f59e0b;
            border: 2px solid white;
            box-shadow: 0 0 0 1px #f59e0b;
          }

          .map-container {
            flex: 1;
            position: relative;
          }

          .map-loading {
            position: absolute;
            top: 50%;
            left: 50%;
            transform: translate(-50%, -50%);
            display: flex;
            flex-direction: column;
            align-items: center;
            gap: 16px;
            z-index: 1000;
          }

          .loading-spinner {
            width: 40px;
            height: 40px;
            border: 4px solid #e2e8f0;
            border-top: 4px solid #3b82f6;
            border-radius: 50%;
            animation: spin 1s linear infinite;
          }

          @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
          }

          /* Mobile Responsive Styles */
          @media (max-width: 768px) {
            .mobile-menu-btn {
              display: flex;
            }

            .mobile-close-btn {
              display: flex;
            }

            .sidebar-overlay {
              display: block;
            }

            .sidebar {
              position: fixed;
              top: 0;
              left: 0;
              height: 100vh;
              width: 90%;
              max-width: 340px;
              transform: translateX(-100%);
              z-index: 1000;
              box-shadow: 0 10px 25px rgba(0, 0, 0, 0.2);
            }

            .sidebar.open {
              transform: translateX(0);
            }

            .sidebar-header {
              padding-top: 60px; /* Account for close button */
            }

            .map-container {
              width: 100%;
            }

            /* Adjust map controls on mobile */
            :global(.leaflet-control-container) {
              margin-top: 80px !important;
            }
          }

          @media (max-width: 480px) {
            .sidebar {
              width: 100%;
              max-width: none;
            }

            .mobile-menu-btn {
              width: 44px;
              height: 44px;
              top: 12px;
              left: 12px;
            }

            .sidebar-header {
              padding: 60px 16px 16px 16px;
            }

            .alarms-section {
              padding: 16px;
            }

            .sidebar-footer {
              padding: 12px 16px;
            }

            .app-title h1 {
              font-size: 20px;
            }

            .title-icon {
              font-size: 24px;
            }
          }

          /* Custom marker styles */
          :global(.user-location-marker) {
            background: transparent !important;
            border: none !important;
          }

          :global(.user-location-dot) {
            position: relative;
            width: 20px;
            height: 20px;
          }

          :global(.user-location-pulse) {
            position: absolute;
            top: 0;
            left: 0;
            width: 20px;
            height: 20px;
            border-radius: 50%;
            background: rgba(59, 130, 246, 0.3);
            animation: userLocationPulse 2s infinite;
          }

          :global(.user-location-inner) {
            position: absolute;
            top: 3px;
            left: 3px;
            width: 14px;
            height: 14px;
            border-radius: 50%;
            background: #3b82f6;
            border: 3px solid white;
            box-shadow: 0 0 0 1px rgba(59, 130, 246, 0.5);
          }

          @keyframes userLocationPulse {
            0% {
              transform: scale(1);
              opacity: 1;
            }
            100% {
              transform: scale(1.5);
              opacity: 0;
            }
          }

          :global(.alarm-location-marker) {
            background: transparent !important;
            border: none !important;
          }

          :global(.alarm-location-dot) {
            position: relative;
            width: 16px;
            height: 16px;
          }

          :global(.alarm-location-inner) {
            position: absolute;
            top: 2px;
            left: 2px;
            width: 12px;
            height: 12px;
            border-radius: 50%;
            background: #f59e0b;
            border: 2px solid white;
            box-shadow: 0 0 0 1px rgba(245, 158, 11, 0.5);
          }

          :global(.alarm-location-dot.triggered .alarm-location-inner) {
            background: #ef4444;
            box-shadow: 0 0 0 1px rgba(239, 68, 68, 0.5);
            animation: alarmBlink 1s infinite;
          }

          @keyframes alarmBlink {
            0%, 100% { opacity: 1; }
            50% { opacity: 0.5; }
          }

          /* Dark mode adjustments for map */
          .dark :global(.leaflet-control-attribution) {
            background: rgba(30, 41, 59, 0.8) !important;
            color: #f1f5f9 !important;
          }

          .dark :global(.leaflet-control-zoom a) {
            background: #374151 !important;
            color: #f1f5f9 !important;
            border-color: #4b5563 !important;
          }

          .dark :global(.leaflet-popup-content-wrapper) {
            background: #374151 !important;
            color: #f1f5f9 !important;
          }

          .dark :global(.leaflet-popup-tip) {
            background: #374151 !important;
          }
        `}
      </style>
      </div>
    </>
  );
}
