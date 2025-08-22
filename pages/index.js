import { useEffect, useState, useCallback, useRef } from "react";
import {
  initializeAudio,
  requestLocationAccess,
  getDistance,
  playVoiceAlert,
  createUserLocationIcon,
  createAlarmIcon,
  searchLocation,
} from "../util/getUtils";
import styles from "../styles/GeoAlarm.module.css";
import { GeoAlarmDB, ServiceWorkerManager, LocationManager } from "../util/db";

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
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSearchResults, setShowSearchResults] = useState(false);

  // Mobile UI states
  const [bottomSheetExpanded, setBottomSheetExpanded] = useState(false);
  const [isMobile, setIsMobile] = useState(false);

  // Enhanced location tracking states
  const [backgroundTrackingEnabled, setBackgroundTrackingEnabled] = useState(false);
  const [locationWatchId, setLocationWatchId] = useState(null);
  const [lastLocationUpdate, setLastLocationUpdate] = useState(null);
  const [locationAccuracy, setLocationAccuracy] = useState(null);
  const [highAccuracyMode, setHighAccuracyMode] = useState(true);

  // Refs for preventing duplicate triggers
  const triggeredAlarmsRef = useRef(new Set());
  const lastTriggerCheckRef = useRef(0);
  const pendingTriggersRef = useRef(new Map());

  // Initialize database and managers
  const [database] = useState(() => new GeoAlarmDB());
  const [swManager] = useState(() => new ServiceWorkerManager());
  const [locationManager] = useState(() => new LocationManager());

  // Detect iOS
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);

  // Check if mobile on mount and resize
  useEffect(() => {
    const checkMobile = () => {
      setIsMobile(window.innerWidth <= 768);
    };

    checkMobile();
    window.addEventListener("resize", checkMobile);

    return () => window.removeEventListener("resize", checkMobile);
  }, []);

  // Initialize map when component mounts
  useEffect(() => {
    if (typeof window === "undefined") return;

    setMapReady(true);

    const script = document.createElement("script");
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
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

    const mapInstance = window.L.map("map", {
      zoomControl: true,
      attributionControl: !isMobile,
    }).setView(userLocation, 13);

    mapInstance.zoomControl.setPosition("topright");

    const tileLayer = darkMode
      ? window.L.tileLayer(
          "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
          {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          }
        )
      : window.L.tileLayer(
          "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          }
        );

    tileLayer.addTo(mapInstance);
    mapInstance.on("click", handleMapClick);
    setMap(mapInstance);
  };

  // Enhanced service worker registration
  useEffect(() => {
    if ("serviceWorker" in navigator) {
      registerServiceWorker();
    }
  }, []);

  const registerServiceWorker = async () => {
    try {
      const registration = await navigator.serviceWorker.register("/sw.js");
      console.log("Service Worker registered:", registration);

      navigator.serviceWorker.addEventListener(
        "message",
        handleServiceWorkerMessage
      );

      if ("Notification" in window && Notification.permission === "default") {
        await Notification.requestPermission();
      }

      return registration;
    } catch (error) {
      console.error("Service Worker registration failed:", error);
    }
  };

  const handleServiceWorkerMessage = (event) => {
    const { type, alarm } = event.data;

    if (type === "ALARM_TRIGGERED") {
      console.log("Alarm triggered in background:", alarm);
      setAlarms((prev) =>
        prev.map((a) =>
          a.createdAt === alarm.id ? { ...a, triggered: true } : a
        )
      );
    }
  };

  // Enhanced location tracking with better accuracy
  const startContinuousLocationTracking = useCallback(() => {
    if (locationWatchId) {
      navigator.geolocation.clearWatch(locationWatchId);
    }

    const options = {
      enableHighAccuracy: highAccuracyMode,
      timeout: isIOS ? 15000 : 10000, // Longer timeout for iOS
      maximumAge: isIOS ? 5000 : 10000, // Shorter max age for iOS
    };

    console.log("Starting location tracking with options:", options);

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { latitude, longitude, accuracy, speed } = position.coords;
        const newLocation = [latitude, longitude];
        const timestamp = Date.now();

        console.log(`Location update: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}, accuracy: ${accuracy}m`);

        // Filter out obviously bad readings
        if (accuracy > 1000) {
          console.warn("Location accuracy too poor, ignoring:", accuracy);
          return;
        }

        // For iOS, be more selective about location updates
        if (isIOS && accuracy > 100 && userLocation) {
          const distance = getDistance(userLocation, newLocation);
          if (distance < accuracy / 2) {
            console.log("iOS: Ignoring location update due to poor accuracy vs distance");
            return;
          }
        }

        // Check if this is a significant location change
        const previousLocation = userLocation;
        if (previousLocation) {
          const distance = getDistance(previousLocation, newLocation);
          const minDistance = Math.max(accuracy / 3, 5); // Dynamic minimum distance based on accuracy
          
          if (distance < minDistance && accuracy > 20) {
            console.log(`Location change too small (${distance.toFixed(1)}m), ignoring`);
            return;
          }
        }

        setUserLocation(newLocation);
        setLocationAccuracy(accuracy);
        setLastLocationUpdate(timestamp);
        
        // Sync with service worker
        syncLocationWithServiceWorker(newLocation);

        // If accuracy is poor, try to get a better reading
        if (accuracy > 50 && highAccuracyMode) {
          console.log("Poor accuracy, requesting high-accuracy location");
          navigator.geolocation.getCurrentPosition(
            (betterPosition) => {
              if (betterPosition.coords.accuracy < accuracy) {
                const betterLocation = [
                  betterPosition.coords.latitude,
                  betterPosition.coords.longitude
                ];
                setUserLocation(betterLocation);
                setLocationAccuracy(betterPosition.coords.accuracy);
                syncLocationWithServiceWorker(betterLocation);
              }
            },
            () => {}, // Ignore errors for this backup request
            { enableHighAccuracy: true, timeout: 5000, maximumAge: 0 }
          );
        }
      },
      (error) => {
        console.error("Location tracking error:", error);
        
        // Try fallback with different options
        if (error.code === error.TIMEOUT && highAccuracyMode) {
          console.log("High accuracy timed out, trying with lower accuracy");
          setHighAccuracyMode(false);
          // Restart with lower accuracy
          setTimeout(() => {
            setHighAccuracyMode(true);
            startContinuousLocationTracking();
          }, 2000);
        } else if (error.code === error.POSITION_UNAVAILABLE) {
          // Try one-time location request
          navigator.geolocation.getCurrentPosition(
            (position) => {
              const newLocation = [
                position.coords.latitude,
                position.coords.longitude,
              ];
              setUserLocation(newLocation);
              setLocationAccuracy(position.coords.accuracy);
              setLastLocationUpdate(Date.now());
            },
            () => {},
            { enableHighAccuracy: false, timeout: 10000, maximumAge: 60000 }
          );
        }
      },
      options
    );

    setLocationWatchId(watchId);
    setIsTracking(true);
  }, [highAccuracyMode, userLocation, locationWatchId, isIOS]);

  const stopContinuousLocationTracking = useCallback(() => {
    if (locationWatchId) {
      navigator.geolocation.clearWatch(locationWatchId);
      setLocationWatchId(null);
    }
    setIsTracking(false);
  }, [locationWatchId]);

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
  }, [backgroundTrackingEnabled, startContinuousLocationTracking, stopContinuousLocationTracking]);

  const syncLocationWithServiceWorker = (location) => {
    if ("serviceWorker" in navigator && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({
        type: "LOCATION_UPDATE",
        data: { location, timestamp: Date.now() },
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
        console.error("Failed to load saved data:", error);
      }
    };

    loadSavedData();
  }, [database]);

  // Save alarms and sync with service worker
  useEffect(() => {
    if (!database || alarms.length === 0) return;

    const saveAlarms = async () => {
      try {
        await database.saveAlarms(alarms);

        if (
          "serviceWorker" in navigator &&
          navigator.serviceWorker.controller
        ) {
          navigator.serviceWorker.controller.postMessage({
            type: "SYNC_ALARMS",
            data: { alarms },
          });
        }
      } catch (error) {
        console.error("Failed to save alarms:", error);
      }
    };

    const hasActiveAlarms = alarms.some(
      (alarm) => !alarm.triggered || alarm.type === "persistent"
    );
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
          backgroundTrackingEnabled,
        });
      } catch (error) {
        console.error("Failed to save settings:", error);
      }
    };

    saveSettings();
  }, [
    darkMode,
    soundEnabled,
    audioInitialized,
    backgroundTrackingEnabled,
    database,
  ]);

  // Update tile layer when dark mode changes
  useEffect(() => {
    if (!map) return;

    map.eachLayer((layer) => {
      if (layer._url) {
        map.removeLayer(layer);
      }
    });

    const tileLayer = darkMode
      ? window.L.tileLayer(
          "https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png",
          {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
          }
        )
      : window.L.tileLayer(
          "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
          {
            attribution:
              '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
          }
        );

    tileLayer.addTo(map);
  }, [darkMode, map]);

  // Update user location marker
  useEffect(() => {
    if (!map || !window.L || !userLocation) return;

    if (userMarker) {
      map.removeLayer(userMarker);
    }

    const newUserMarker = window.L.marker(userLocation, {
      icon: createUserLocationIcon(),
    }).addTo(map);

    const accuracyText = locationAccuracy ? ` (±${Math.round(locationAccuracy)}m)` : '';
    newUserMarker.bindPopup(`Your current location${accuracyText}`);
    setUserMarker(newUserMarker);
    
    // Only pan to user location if it's a significant change or first time
    const currentCenter = map.getCenter();
    const distance = getDistance([currentCenter.lat, currentCenter.lng], userLocation);
    if (distance > 100) { // Only pan if more than 100m away
      map.setView(userLocation, Math.max(map.getZoom(), 15));
    }
  }, [userLocation, map, locationAccuracy]);

  // Update alarm markers
  useEffect(() => {
    if (!map || !window.L) return;

    alarmMarkers.forEach((marker) => {
      map.removeLayer(marker.marker);
      map.removeLayer(marker.circle);
    });

    const newMarkers = alarms.map((alarm, i) => {
      const marker = window.L.marker(alarm.location, {
        icon: createAlarmIcon(alarm.triggered),
      }).addTo(map);

      const distance = userLocation ? Math.round(getDistance(userLocation, alarm.location)) : 'Unknown';
      marker.bindPopup(`
        <div>
          <strong>${alarm.name}</strong><br/>
          Radius: ${alarm.radius}m<br/>
          Distance: ${distance}m<br/>
          Status: ${alarm.triggered ? "🚨 TRIGGERED" : "✅ Active"}
        </div>
      `);

      const circle = window.L.circle(alarm.location, {
        radius: alarm.radius,
        color: alarm.triggered ? "#ef4444" : "#fbbf24",
        fillColor: alarm.triggered ? "#ef4444" : "#fbbf24",
        fillOpacity: 0.2,
        weight: 2,
      }).addTo(map);

      return { marker, circle, alarm };
    });

    setAlarmMarkers(newMarkers);
  }, [alarms, map, userLocation]);

  // Enhanced alarm trigger checking with debouncing
  useEffect(() => {
    if (!userLocation || !Array.isArray(alarms) || alarms.length === 0) return;

    const now = Date.now();
    
    // Throttle trigger checks (max once per 2 seconds)
    if (now - lastTriggerCheckRef.current < 2000) {
      return;
    }
    lastTriggerCheckRef.current = now;

    try {
      const currentTime = new Date();
      const activeAlarms = alarms.filter((alarm) => {
        if (alarm.expiresAt && new Date(alarm.expiresAt) < currentTime) {
          return false;
        }
        return true;
      });

      // Clean expired alarms
      if (activeAlarms.length !== alarms.length) {
        setAlarms(activeAlarms);
        setTimeout(async () => {
          try {
            await database.saveAlarms(activeAlarms);
            if (
              "serviceWorker" in navigator &&
              navigator.serviceWorker.controller
            ) {
              navigator.serviceWorker.controller.postMessage({
                type: "SYNC_ALARMS",
                data: { alarms: activeAlarms },
              });
            }
            console.log("Expired alarms cleaned from storage");
          } catch (error) {
            console.error("Failed to clean expired alarms from storage:", error);
          }
        }, 100);
        return;
      }

      // Check each alarm
      activeAlarms.forEach((alarm, index) => {
        if (
          alarm &&
          !alarm.triggered &&
          alarm.location &&
          Array.isArray(alarm.location)
        ) {
          const distance = getDistance(userLocation, alarm.location);
          const alarmKey = `${alarm.createdAt}-${index}`;
          
          // Dynamic trigger radius based on location accuracy
          const baseRadius = alarm.radius;
          const accuracyBuffer = locationAccuracy ? Math.min(locationAccuracy * 0.5, 20) : 10;
          const triggerRadius = baseRadius + accuracyBuffer;

          console.log(
            `Alarm "${alarm.name}": distance=${distance.toFixed(1)}m, trigger=${triggerRadius.toFixed(1)}m, accuracy=${locationAccuracy || 'unknown'}m`
          );

          if (distance <= triggerRadius) {
            // Check if already triggered recently
            if (triggeredAlarmsRef.current.has(alarmKey)) {
              return;
            }

            // Add to triggered set to prevent duplicates
            triggeredAlarmsRef.current.add(alarmKey);
            
            console.log(`Triggering alarm: ${alarm.name} (distance: ${distance.toFixed(1)}m)`);
            triggerAlarm(index);

            // Remove from triggered set after 10 seconds
            setTimeout(() => {
              triggeredAlarmsRef.current.delete(alarmKey);
            }, 10000);
          }
        }
      });
    } catch (error) {
      console.error("Error checking alarm triggers:", error);
    }
  }, [userLocation, alarms, locationAccuracy]);

  // Enhanced trigger alarm function with auto-removal after 3 seconds
  async function triggerAlarm(index) {
    try {
      const alarm = alarms[index];
      if (!alarm || alarm.triggered) return;

      console.log("Triggering alarm:", alarm.name);

      // Update alarm state immediately
      setAlarms((prev) =>
        prev.map((a, i) => (i === index ? { ...a, triggered: true } : a))
      );

      const alarmName = alarm.name || "Unknown Location";

      // Initialize audio if needed
      if (!audioInitialized && soundEnabled) {
        console.log("Audio not initialized, attempting to initialize...");
        try {
          const initialized = await initializeAudio(false, true);
          if (initialized) {
            setAudioInitialized(true);
          }
        } catch (error) {
          console.error("Failed to initialize audio during trigger:", error);
        }
      }

      // Play sound with platform-specific delays
      if (soundEnabled) {
        const delay = isIOS ? 500 : 200; // Longer delay for iOS

        setTimeout(async () => {
          try {
            await playVoiceAlert(alarmName);
          } catch (error) {
            console.error("Voice alert failed in trigger:", error);
          }
        }, delay);
      }

      // Enhanced notification
      try {
        if (typeof window !== "undefined" && "Notification" in window) {
          if (Notification.permission === "granted") {
            const notification = new Notification("🚨 Geo-Alarm Triggered!", {
              body: `You're near: ${alarmName}`,
              icon: "/favicon.ico",
              tag: `alarm-${index}`,
              requireInteraction: true,
              vibrate: [200, 100, 200, 100, 200],
              silent: false,
            });

            setTimeout(() => {
              try {
                notification.close();
              } catch (e) {
                // Ignore close errors
              }
            }, 10000);

            notification.onclick = () => {
              window.focus();
              notification.close();
            };
          }
        }
      } catch (notificationError) {
        console.log("Notification failed:", notificationError);
      }

      // Enhanced vibration
      try {
        if ("vibrate" in navigator) {
          navigator.vibrate([200, 100, 200, 100, 200, 100, 400]);
        }
      } catch (vibrateError) {
        console.log("Vibration failed:", vibrateError);
      }

      // Auto-remove triggered status after 3 seconds
      setTimeout(() => {
        setAlarms((prev) =>
          prev.map((a, i) => (i === index ? { ...a, triggered: false } : a))
        );
        console.log(`Auto-reset alarm: ${alarmName}`);
      }, 3000);

      // Handle one-time alarms - delete after 8 seconds (gives time for user to see trigger)
      if (alarm.type === "oneTime") {
        setTimeout(async () => {
          try {
            setAlarms((prevAlarms) => {
              const newAlarms = prevAlarms.filter((_, i) => i !== index);
              
              // Save to database asynchronously
              database.saveAlarms(newAlarms).catch(console.error);
              
              // Sync with service worker
              if (
                "serviceWorker" in navigator &&
                navigator.serviceWorker.controller
              ) {
                navigator.serviceWorker.controller.postMessage({
                  type: "SYNC_ALARMS",
                  data: { alarms: newAlarms },
                });
              }
              
              return newAlarms;
            });

            console.log("One-time alarm deleted from storage:", alarmName);
          } catch (error) {
            console.error("Failed to delete alarm from storage:", error);
          }
        }, 8000);
      }
    } catch (error) {
      console.error("Error in triggerAlarm:", error);
    }
  }

  function resetAlarm(index) {
    setAlarms((prev) =>
      prev.map((a, i) => (i === index ? { ...a, triggered: false } : a))
    );

    // Enhanced audio feedback for reset
    if (soundEnabled) {
      const alarm = alarms[index];
      if (alarm) {
        const delay = isIOS ? 300 : 150;

        setTimeout(async () => {
          try {
            if (!audioInitialized) {
              const initialized = await initializeAudio(false, true);
              if (initialized) {
                setAudioInitialized(true);
              }
            }

            await playVoiceAlert(`${alarm.name} reset`);
          } catch (error) {
            console.error("Reset audio feedback failed:", error);
          }
        }, delay);
      }
    }
  }

  // Handle map click to create new alarm
  const handleMapClick = (e) => {
    if (!map || !e.latlng) return;
    const { lat, lng } = e.latlng;
    const location = [lat, lng];
    const name = prompt("Enter alarm name:", `Alarm at ${lat.toFixed(4)}, ${lng.toFixed(4)}`);
    if (!name) return;
    const radiusInput = prompt("Enter radius in meters (default: 100):");
    const radius = parseInt(radiusInput) || 100;
    const alarmType = confirm(
      "One-time use alarm? (OK = Yes, Cancel = Persistent)"
    ) ? "oneTime" : "persistent";
    
    let expiresAt = null;
    if (alarmType === "persistent") {
      const hours = prompt(
        "Auto-delete after how many hours? (default: never, enter 0 for never):"
      );
      const hoursNum = parseInt(hours);
      if (hoursNum && hoursNum > 0) {
        expiresAt = new Date(Date.now() + hoursNum * 60 * 60 * 1000).toISOString();
      }
    }
    
    const newAlarm = {
      name,
      location,
      radius,
      triggered: false,
      createdAt: new Date().toISOString(),
      type: alarmType,
      expiresAt: expiresAt,
    };
    
    setAlarms((prev) => [...prev, newAlarm]);
    
    setTimeout(() => {
      if (map) {
        map.setView(location, 16);
      }
    }, 500);
  };

  // Delete alarm function with fixed syntax
  const deleteAlarm = async (index) => {
    if (index < 0 || index >= alarms.length) {
      return;
    }
    
    const alarm = alarms[index];
    if (!alarm) return;
    
    const confirmDelete = confirm(
      `Are you sure you want to delete the alarm: ${alarm.name}?`
    );
    if (!confirmDelete) return;
    
    const newAlarms = alarms.filter((_, i) => i !== index);
    setAlarms(newAlarms);
    
    try {
      await database.saveAlarms(newAlarms);
      if (
        "serviceWorker" in navigator &&
        navigator.serviceWorker.controller
      ) {
        navigator.serviceWorker.controller.postMessage({
          type: "SYNC_ALARMS",
          data: { alarms: newAlarms },
        });
      }
      console.log("Alarm deleted from storage:", alarm.name);
    } catch (error) {
      console.error("Failed to delete alarm from storage:", error);
    }
  };

  const handleRequestLocation = () => {
    requestLocationAccess(
      setIsTracking, 
      (location) => {
        setUserLocation(location);
        // Start continuous tracking after initial location
        setTimeout(() => {
          setBackgroundTrackingEnabled(true);
        }, 1000);
      }, 
      () => setIsTracking(false)
    );
  };

  const toggleBackgroundTracking = () => {
    setBackgroundTrackingEnabled(!backgroundTrackingEnabled);
  };

  // Enhanced audio initialization
  const handleInitializeAudio = async () => {
    try {
      console.log("Manual audio initialization requested");

      const result = await initializeAudio(audioInitialized, soundEnabled);
      setAudioInitialized(result);

      if (result) {
        console.log("Audio successfully initialized");

        if ("vibrate" in navigator) {
          navigator.vibrate([100, 50, 100]);
        }

        // Test audio with platform-specific delay
        setTimeout(async () => {
          try {
            await playVoiceAlert("Audio is now ready");
          } catch (error) {
            console.error("Test audio failed:", error);
          }
        }, isIOS ? 300 : 200);
      } else {
        console.warn("Audio initialization failed");
        alert(
          "Audio initialization failed. Please try again or check your browser settings."
        );
      }
    } catch (error) {
      console.error("Manual audio initialization error:", error);
      alert("Audio setup failed. This may be due to browser restrictions.");
    }
  };

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
      console.error("Search failed:", error);
      alert("Search failed. Please try again.");
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

    setSearchQuery("");
    setSearchResults([]);
    setShowSearchResults(false);

    setTimeout(() => {
      const createAlarm = confirm(`Create alarm at: ${display_name}?`);
      if (createAlarm) {
        const name = prompt("Enter alarm name:", display_name.split(",")[0]);
        if (name) {
          const radiusInput = prompt("Enter radius in meters (default: 100):");
          const radius = parseInt(radiusInput) || 100;

          const alarmType = confirm(
            "One-time use alarm? (OK = Yes, Cancel = Persistent)"
          ) ? "oneTime" : "persistent";

          let expiresAt = null;
          if (alarmType === "persistent") {
            const hours = prompt(
              "Auto-delete after how many hours? (default: never, enter 0 for never):"
            );
            const hoursNum = parseInt(hours);
            if (hoursNum && hoursNum > 0) {
              expiresAt = new Date(
                Date.now() + hoursNum * 60 * 60 * 1000
              ).toISOString();
            }
          }

          setAlarms((prev) => [
            ...prev,
            {
              name,
              location,
              radius,
              triggered: false,
              createdAt: new Date().toISOString(),
              type: alarmType,
              expiresAt: expiresAt,
            },
          ]);
        }
      }
    }, 500);
  };

  const clearSearch = () => {
    setSearchQuery("");
    setSearchResults([]);
    setShowSearchResults(false);
  };

  const toggleBottomSheet = () => {
    setBottomSheetExpanded(!bottomSheetExpanded);
  };

  // Handle search input focus to prevent viewport zoom
  const handleSearchFocus = (e) => {
    e.target.style.fontSize = "16px";

    if (isMobile) {
      setTimeout(() => {
        window.scrollTo({ top: 0, behavior: "smooth" });
      }, 300);
    }
  };

  const renderDesktopSidebar = () => (
    <div className={styles.sidebar}>
      {/* Desktop Header */}
      <div className={styles.sidebarHeader}>
        <div className={styles.appTitle}>
          <span className={styles.titleIcon}>🧭</span>
          <h1>GeoAlarm</h1>
        </div>
        <div className={styles.headerControls}>
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`${styles.controlBtn} ${
              soundEnabled ? styles.active : ""
            }`}
            title="Toggle Sound"
          >
            🔊
          </button>
          <button
            onClick={() => setDarkMode(!darkMode)}
            className={styles.controlBtn}
            title="Toggle Theme"
          >
            {darkMode ? "☀️" : "🌙"}
          </button>
        </div>
      </div>

      {/* Desktop Search Section */}
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
              {isSearching ? "🔄" : "🔍"}
            </button>
          </div>
        </form>

        {/* Desktop Search Results */}
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
                          {result.display_name.split(",")[0]}
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

      {/* Desktop Status */}
      <div className={styles.statusSection}>
        <div
          className={`${styles.statusIndicator} ${
            isTracking ? styles.active : styles.inactive
          }`}
        >
          <div className={styles.statusDot}></div>
          <span>
            {isTracking
              ? "Location tracking active"
              : "Location tracking disabled"}
            {lastLocationUpdate && (
              <small>
                {" "}
                • Last update:{" "}
                {new Date(lastLocationUpdate).toLocaleTimeString()}
              </small>
            )}
            {locationAccuracy && (
              <small> • Accuracy: ±{Math.round(locationAccuracy)}m</small>
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
          <button onClick={handleInitializeAudio} className={styles.audioBtn}>
            🔊 Enable Sound Alerts
          </button>
        )}

        {/* High accuracy mode toggle */}
        <div className={styles.backgroundTrackingSection}>
          <label className={styles.toggleLabel}>
            <input
              type="checkbox"
              checked={highAccuracyMode}
              onChange={() => setHighAccuracyMode(!highAccuracyMode)}
              className={styles.toggleInput}
            />
            <span className={styles.toggleSlider}></span>
            <span>High accuracy GPS mode</span>
          </label>
          <small>Uses more battery but more precise location</small>
        </div>
      </div>

      {/* Desktop Alarms */}
      <div className={styles.alarmsSection}>
        <h2 className={styles.sectionTitle}>🔔 My Alarms ({alarms.length})</h2>

        {alarms.length === 0 && (
          <div className={styles.emptyState}>
            <div className={styles.emptyIcon}>📍</div>
            <p>No alarms set</p>
            <small>Click on the map to create one</small>
          </div>
        )}

        <div className={styles.alarmsList}>
          {alarms.map((alarm, i) => (
            <div
              key={i}
              className={`${styles.alarmCard} ${
                alarm.triggered ? styles.triggered : ""
              }`}
            >
              <div className={styles.alarmInfo}>
                <div className={styles.alarmHeader}>
                  <span
                    className={`${styles.alarmBell} ${
                      alarm.triggered ? styles.triggered : ""
                    }`}
                  >
                    {alarm.triggered ? "🚨" : "🔔"}
                  </span>
                  <h3>{alarm.name}</h3>
                </div>
                <div className={styles.alarmDetails}>
                  <p>Radius: {alarm.radius}m</p>
                  <p className={styles.coordinates}>
                    {alarm.location[0].toFixed(4)},{" "}
                    {alarm.location[1].toFixed(4)}
                  </p>
                  <p
                    className={`${styles.alarmType} ${
                      alarm.type === "oneTime"
                        ? styles.oneTime
                        : styles.persistent
                    }`}
                  >
                    {alarm.type === "oneTime"
                      ? "🔄 One-time use"
                      : "🔁 Persistent"}
                  </p>
                  {alarm.expiresAt && (
                    <p className={styles.expiresAt}>
                      ⏰ Expires: {new Date(alarm.expiresAt).toLocaleString()}
                    </p>
                  )}
                  {alarm.triggered && (
                    <p className={styles.triggeredStatus}>🚨 TRIGGERED (auto-reset in 3s)</p>
                  )}
                  {userLocation && (
                    <p className={styles.distance}>
                      Distance:{" "}
                      {Math.round(getDistance(userLocation, alarm.location))}m
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
                    Reset Now
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

      {/* Desktop Footer */}
      <div className={styles.sidebarFooter}>
        <div className={styles.legend}>
          <div className={styles.legendItem}>
            <div className={`${styles.legendDot} ${styles.userLocation}`}></div>
            <span>Your location</span>
          </div>
          <div className={styles.legendItem}>
            <div
              className={`${styles.legendDot} ${styles.alarmLocation}`}
            ></div>
            <span>Alarm location</span>
          </div>
        </div>
        <p>
          Click anywhere on the map to create a new geo-alarm, or use search to
          find locations
        </p>
        {isIOS && (
          <small style={{ color: '#f59e0b', marginTop: '8px', display: 'block' }}>
            📱 iOS detected - For best results, keep app open and allow location access
          </small>
        )}
      </div>
    </div>
  );

  const renderMobileUI = () => (
    <>
      {/* Mobile Top Bar */}
      <div className={styles.mobileTopBar}>
        <div className={styles.mobileSearchWrapper}>
          <form onSubmit={handleSearch}>
            <input
              type="text"
              placeholder="Search places..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onFocus={handleSearchFocus}
              className={styles.mobileSearchInput}
            />
            <button
              type="submit"
              disabled={isSearching || !searchQuery.trim()}
              className={`${styles.mobileSearchBtn} ${
                isSearching ? styles.loading : ""
              }`}
            >
              {isSearching ? "🔄" : "🔍"}
            </button>
          </form>
        </div>

        <div className={styles.mobileTopControls}>
          <button
            onClick={() => setSoundEnabled(!soundEnabled)}
            className={`${styles.mobileControlBtn} ${
              soundEnabled ? styles.active : ""
            }`}
            title="Toggle Sound"
          >
            🔊
          </button>
          <button
            onClick={() => setDarkMode(!darkMode)}
            className={styles.mobileControlBtn}
            title="Toggle Theme"
          >
            {darkMode ? "☀️" : "🌙"}
          </button>
        </div>
      </div>

      {/* Mobile Search Results */}
      {showSearchResults && (
        <div
          className={`${styles.mobileSearchResults} ${
            showSearchResults ? styles.show : ""
          }`}
        >
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
                        {result.display_name.split(",")[0]}
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

      {/* Mobile Floating Action Button */}
      <button
        className={styles.mobileFab}
        onClick={() => alert("Tap anywhere on the map to create an alarm")}
        title="Create new alarm"
      >
        +
      </button>

      {/* Mobile Bottom Sheet */}
      <div
        className={`${styles.mobileBottomSheet} ${
          bottomSheetExpanded ? styles.expanded : ""
        }`}
      >
        <div
          className={styles.bottomSheetHandle}
          onClick={toggleBottomSheet}
        ></div>

        <div className={styles.bottomSheetHeader} onClick={toggleBottomSheet}>
          <h2 className={styles.bottomSheetTitle}>
            🧭 GeoAlarm
            <span className={styles.bottomSheetStatus}>
              <div
                className={`${styles.statusDot} ${
                  isTracking ? styles.active : ""
                }`}
              ></div>
              {isTracking ? "Active" : "Inactive"} • {alarms.length} alarms
              {locationAccuracy && ` • ±${Math.round(locationAccuracy)}m`}
            </span>
          </h2>
          <span
            style={{
              fontSize: "18px",
              transform: bottomSheetExpanded ? "rotate(180deg)" : "rotate(0)",
              transition: "transform 0.3s",
            }}
          >
            ▲
          </span>
        </div>

        <div className={styles.bottomSheetContent}>
          {/* Quick Actions */}
          <div className={styles.quickActions}>
            {!isTracking ? (
              <button
                onClick={handleRequestLocation}
                className={styles.quickActionBtn}
              >
                <div className={styles.quickActionIcon}>📍</div>
                <div className={styles.quickActionLabel}>Enable Location</div>
              </button>
            ) : (
              <div className={`${styles.quickActionBtn} ${styles.active}`}>
                <div className={styles.quickActionIcon}>✅</div>
                <div className={styles.quickActionLabel}>Location Active</div>
              </div>
            )}

            {!audioInitialized && isTracking && soundEnabled ? (
              <button
                onClick={handleInitializeAudio}
                className={styles.quickActionBtn}
              >
                <div className={styles.quickActionIcon}>🔊</div>
                <div className={styles.quickActionLabel}>Enable Audio</div>
              </button>
            ) : (
              <div
                className={`${styles.quickActionBtn} ${
                  audioInitialized ? styles.active : ""
                }`}
              >
                <div className={styles.quickActionIcon}>
                  {audioInitialized ? "🔊" : "🔇"}
                </div>
                <div className={styles.quickActionLabel}>
                  {audioInitialized ? "Audio Ready" : "Audio Off"}
                </div>
              </div>
            )}
          </div>

          {isIOS && (
            <div style={{ 
              background: '#f59e0b20', 
              border: '1px solid #f59e0b', 
              borderRadius: '8px', 
              padding: '12px', 
              margin: '12px 0',
              fontSize: '14px'
            }}>
              📱 <strong>iOS Tips:</strong> Keep app open for best location tracking. 
              Enable location permissions and disable low power mode for accurate alerts.
            </div>
          )}

          {/* Status Section */}
          <div className={styles.statusSection}>
            <div
              className={`${styles.statusIndicator} ${
                isTracking ? styles.active : styles.inactive
              }`}
            >
              <div className={styles.statusDot}></div>
              <span>
                {isTracking
                  ? "Location tracking active"
                  : "Location tracking disabled"}
                {lastLocationUpdate && (
                  <small>
                    {" "}
                    • Last update:{" "}
                    {new Date(lastLocationUpdate).toLocaleTimeString()}
                  </small>
                )}
                {locationAccuracy && (
                  <small> • Accuracy: ±{Math.round(locationAccuracy)}m</small>
                )}
              </span>
            </div>

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

            {/* High accuracy mode toggle */}
            <div className={styles.backgroundTrackingSection}>
              <label className={styles.toggleLabel}>
                <input
                  type="checkbox"
                  checked={highAccuracyMode}
                  onChange={() => setHighAccuracyMode(!highAccuracyMode)}
                  className={styles.toggleInput}
                />
                <span className={styles.toggleSlider}></span>
                <span>High accuracy GPS mode</span>
              </label>
              <small>Uses more battery but more precise location</small>
            </div>
          </div>

          {/* Mobile Alarms */}
          <div className={styles.alarmsSection}>
            <h2 className={styles.sectionTitle}>
              🔔 My Alarms ({alarms.length})
            </h2>

            {alarms.length === 0 && (
              <div className={styles.emptyState}>
                <div className={styles.emptyIcon}>📍</div>
                <p>No alarms set</p>
                <small>Tap on the map to create one</small>
              </div>
            )}

            <div className={styles.alarmsList}>
              {alarms.map((alarm, i) => (
                <div
                  key={i}
                  className={`${styles.alarmCard} ${
                    alarm.triggered ? styles.triggered : ""
                  }`}
                >
                  <div className={styles.alarmInfo}>
                    <div className={styles.alarmHeader}>
                      <span
                        className={`${styles.alarmBell} ${
                          alarm.triggered ? styles.triggered : ""
                        }`}
                      >
                        {alarm.triggered ? "🚨" : "🔔"}
                      </span>
                      <h3>{alarm.name}</h3>
                    </div>
                    <div className={styles.alarmDetails}>
                      <p>Radius: {alarm.radius}m</p>
                      <p className={styles.coordinates}>
                        {alarm.location[0].toFixed(4)},{" "}
                        {alarm.location[1].toFixed(4)}
                      </p>
                      <p
                        className={`${styles.alarmType} ${
                          alarm.type === "oneTime"
                            ? styles.oneTime
                            : styles.persistent
                        }`}
                      >
                        {alarm.type === "oneTime"
                          ? "🔄 One-time use"
                          : "🔁 Persistent"}
                      </p>
                      {alarm.expiresAt && (
                        <p className={styles.expiresAt}>
                          ⏰ Expires:{" "}
                          {new Date(alarm.expiresAt).toLocaleString()}
                        </p>
                      )}
                      {alarm.triggered && (
                        <p className={styles.triggeredStatus}>🚨 TRIGGERED (auto-reset in 3s)</p>
                      )}
                      {userLocation && (
                        <p className={styles.distance}>
                          Distance:{" "}
                          {Math.round(
                            getDistance(userLocation, alarm.location)
                          )}
                          m
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
                        Reset Now
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
        </div>
      </div>
    </>
  );

  return (
    <>
      <link
        rel="stylesheet"
        href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"
        integrity="sha256-p4NxAoJBhIIN+hmNHrzRCf9tD/miZyoHS5obTRR9BMY="
        crossOrigin=""
      />

      <div className={`${styles.appContainer} ${darkMode ? styles.dark : ""}`}>
        {/* Render different UI based on screen size */}
        {!isMobile && renderDesktopSidebar()}
        {isMobile && renderMobileUI()}

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
