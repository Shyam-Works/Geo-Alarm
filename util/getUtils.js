// // Enhanced background location tracking utilities
// let wakeLock = null;
// let locationWatchId = null;
// let backgroundLocationInterval = null;
// let isBackgroundMode = false;

// // Initialize audio on first user interaction (mobile requirement)
// export const initializeAudio = async (audioInitialized, soundEnabled) => {
//   if (audioInitialized || !soundEnabled) return audioInitialized;
  
//   try {
//     const AudioContextClass = window.AudioContext || window.webkitAudioContext;
//     if (AudioContextClass) {
//       const audioContext = new AudioContextClass();
//       if (audioContext.state === 'suspended') {
//         await audioContext.resume();
//       }
      
//       // Test voice synthesis
//       if ('speechSynthesis' in window) {
//         const testUtterance = new SpeechSynthesisUtterance('');
//         testUtterance.volume = 0.01;
//         speechSynthesis.speak(testUtterance);
//       }
      
//       console.log('Audio initialized successfully');
//       return true;
//     }
//   } catch (error) {
//     console.log('Audio initialization failed:', error);
//   }
//   return false;
// };

// // Request wake lock to keep screen active (optional, user preference)
// export const requestWakeLock = async () => {
//   try {
//     if ('wakeLock' in navigator) {
//       wakeLock = await navigator.wakeLock.request('screen');
//       console.log('Wake lock acquired');
      
//       wakeLock.addEventListener('release', () => {
//         console.log('Wake lock released');
//         wakeLock = null;
//       });
      
//       return true;
//     }
//   } catch (error) {
//     console.error('Wake lock failed:', error);
//   }
//   return false;
// };

// // Release wake lock
// export const releaseWakeLock = () => {
//   if (wakeLock) {
//     wakeLock.release();
//     wakeLock = null;
//   }
// };

// // Enhanced location access with background tracking
// export const requestLocationAccess = (setIsTracking, setUserLocation, onError) => {
//   if (!navigator.geolocation) {
//     alert('Geolocation is not supported by this browser');
//     return;
//   }

//   // Clear any existing watchers
//   if (locationWatchId) {
//     navigator.geolocation.clearWatch(locationWatchId);
//     locationWatchId = null;
//   }
  
//   if (backgroundLocationInterval) {
//     clearInterval(backgroundLocationInterval);
//     backgroundLocationInterval = null;
//   }

//   setIsTracking(true);
  
//   // High accuracy options for active tracking
//   const highAccuracyOptions = {
//     enableHighAccuracy: true,
//     timeout: 10000,
//     maximumAge: 5000
//   };

//   // Lower power options for background tracking
//   const backgroundOptions = {
//     enableHighAccuracy: false,
//     timeout: 30000,
//     maximumAge: 60000
//   };

//   const successCallback = (position) => {
//     try {
//       if (position && position.coords) {
//         const newLocation = [position.coords.latitude, position.coords.longitude];
//         setUserLocation(newLocation);
//         setIsTracking(true);
//         console.log('Location updated:', newLocation);
//       }
//     } catch (error) {
//       console.error("Error processing location:", error);
//       onError();
//     }
//   };

//   const errorCallback = (error) => {
//     console.error("Geolocation error:", error);
    
//     // Don't immediately fail - try background mode
//     if (!isBackgroundMode) {
//       startBackgroundLocationTracking(setUserLocation, setIsTracking);
//     }
    
//     // Show user-friendly error messages only for critical errors
//     let errorMessage = "Location tracking encountered an issue. ";
//     try {
//       switch(error.code) {
//         case 1: // PERMISSION_DENIED
//           errorMessage += "Please enable location access in your browser settings.";
//           alert(errorMessage);
//           onError();
//           break;
//         case 2: // POSITION_UNAVAILABLE
//           console.warn("Position unavailable, continuing with background tracking");
//           break;
//         case 3: // TIMEOUT
//           console.warn("Location timeout, continuing with background tracking");
//           break;
//         default:
//           console.warn("Unknown location error, continuing with background tracking");
//       }
//     } catch (alertError) {
//       console.error("Error showing location error message:", alertError);
//     }
//   };

//   try {
//     // Start primary location watching
//     locationWatchId = navigator.geolocation.watchPosition(
//       successCallback,
//       errorCallback,
//       highAccuracyOptions
//     );

//     // Set up background tracking as backup
//     startBackgroundLocationTracking(setUserLocation, setIsTracking);

//     // Set up visibility change handlers
//     setupBackgroundHandlers(setUserLocation, setIsTracking);

//     return () => {
//       if (locationWatchId) {
//         navigator.geolocation.clearWatch(locationWatchId);
//         locationWatchId = null;
//       }
//       if (backgroundLocationInterval) {
//         clearInterval(backgroundLocationInterval);
//         backgroundLocationInterval = null;
//       }
//       releaseWakeLock();
//     };
//   } catch (error) {
//     console.error("Error setting up geolocation watch:", error);
//     onError();
//   }
// };

// // Background location tracking with intervals
// const startBackgroundLocationTracking = (setUserLocation, setIsTracking) => {
//   if (backgroundLocationInterval) return;
  
//   console.log('Starting background location tracking');
  
//   const backgroundOptions = {
//     enableHighAccuracy: false,
//     timeout: 30000,
//     maximumAge: 30000
//   };

//   backgroundLocationInterval = setInterval(() => {
//     navigator.geolocation.getCurrentPosition(
//       (position) => {
//         if (position && position.coords) {
//           const newLocation = [position.coords.latitude, position.coords.longitude];
//           setUserLocation(newLocation);
//           setIsTracking(true);
//           console.log('Background location updated:', newLocation);
//         }
//       },
//       (error) => {
//         console.warn('Background location failed:', error);
//         // Don't stop tracking, just log the error
//       },
//       backgroundOptions
//     );
//   }, 30000); // Update every 30 seconds in background
// };

// // Setup handlers for page visibility changes
// const setupBackgroundHandlers = (setUserLocation, setIsTracking) => {
//   // Handle page visibility changes
//   document.addEventListener('visibilitychange', () => {
//     if (document.hidden) {
//       console.log('Page hidden - switching to background mode');
//       isBackgroundMode = true;
//       // Switch to more aggressive background tracking
//       if (backgroundLocationInterval) {
//         clearInterval(backgroundLocationInterval);
//       }
//       startBackgroundLocationTracking(setUserLocation, setIsTracking);
//     } else {
//       console.log('Page visible - switching to active mode');
//       isBackgroundMode = false;
//     }
//   });

//   // Handle page focus/blur
//   window.addEventListener('blur', () => {
//     console.log('Window blurred - maintaining location tracking');
//     isBackgroundMode = true;
//   });

//   window.addEventListener('focus', () => {
//     console.log('Window focused - resuming active tracking');
//     isBackgroundMode = false;
//   });

//   // Handle beforeunload to maintain tracking
//   window.addEventListener('beforeunload', (e) => {
//     // Keep tracking active even when page is being unloaded
//     console.log('Page unloading - attempting to maintain location tracking');
//   });

//   // Service Worker registration for background sync (if available)
//   if ('serviceWorker' in navigator) {
//     registerServiceWorker();
//   }
// };

// // Register service worker for background processing
// const registerServiceWorker = async () => {
//   try {
//     const registration = await navigator.serviceWorker.register('/sw.js');
//     console.log('Service Worker registered:', registration);
//   } catch (error) {
//     console.log('Service Worker registration failed:', error);
//   }
// };

// // Calculate distance between two coordinates
// export function getDistance(loc1, loc2) {
//   try {
//     if (!loc1 || !loc2 || !Array.isArray(loc1) || !Array.isArray(loc2)) {
//       console.warn("Invalid locations for distance calculation");
//       return Infinity; // Return large distance to avoid false triggers
//     }

//     const R = 6371e3; // Earth's radius in meters
//     const φ1 = (loc1[0] * Math.PI) / 180;
//     const φ2 = (loc2[0] * Math.PI) / 180;
//     const Δφ = ((loc2[0] - loc1[0]) * Math.PI) / 180;
//     const Δλ = ((loc2[1] - loc1[1]) * Math.PI) / 180;

//     const a = Math.sin(Δφ / 2) ** 2 + Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
//     const distance = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    
//     return isNaN(distance) ? Infinity : distance;
//   } catch (error) {
//     console.error("Error calculating distance:", error);
//     return Infinity;
//   }
// }

// // Enhanced voice alert function with background support
// export function playVoiceAlert(alarmName) {
//   try {
//     // Method 1: Speech Synthesis (works best on mobile)
//     if ('speechSynthesis' in window) {
//       // Stop any ongoing speech
//       speechSynthesis.cancel();
      
//       // Play voice alert 3 times with background-friendly settings
//       for (let i = 0; i < 3; i++) {
//         setTimeout(() => {
//           const utterance = new SpeechSynthesisUtterance(`Alarm triggered. You have reached ${alarmName}`);
//           utterance.rate = 1.2;
//           utterance.volume = 1.0;
//           utterance.pitch = 1.0;
          
//           // Add error handling for background mode
//           utterance.onerror = (event) => {
//             console.log('Speech synthesis error:', event);
//             playBackupSound();
//           };
          
//           speechSynthesis.speak(utterance);
//         }, i * 2000); // 2 second delay between each announcement
//       }
//     }
    
//     // Method 2: Backup sound (beeps)
//     setTimeout(() => {
//       playBackupSound();
//     }, 500);

//     // Method 3: Vibration if available
//     if ('vibrate' in navigator) {
//       navigator.vibrate([500, 200, 500, 200, 500]);
//     }
    
//   } catch (error) {
//     console.log("Voice alert failed:", error);
//     playBackupSound();
//   }
// }

// // Backup sound method with enhanced compatibility
// function playBackupSound() {
//   try {
//     const AudioContextClass = window.AudioContext || window.webkitAudioContext;
//     if (AudioContextClass) {
//       const audioContext = new AudioContextClass();
      
//       if (audioContext.state === 'suspended') {
//         audioContext.resume().then(() => {
//           playBeepSequence(audioContext);
//         });
//       } else {
//         playBeepSequence(audioContext);
//       }
//     }
//   } catch (error) {
//     console.log("Backup sound failed:", error);
//   }
// }

// function playBeepSequence(audioContext) {
//   try {
//     // Play 3 urgent beeps
//     for (let i = 0; i < 3; i++) {
//       const startTime = audioContext.currentTime + (i * 0.6);
      
//       const oscillator = audioContext.createOscillator();
//       const gainNode = audioContext.createGain();
      
//       oscillator.connect(gainNode);
//       gainNode.connect(audioContext.destination);
      
//       // Higher frequency for urgency
//       oscillator.frequency.setValueAtTime(1200, startTime);
//       gainNode.gain.setValueAtTime(0.5, startTime);
//       gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.4);
      
//       oscillator.start(startTime);
//       oscillator.stop(startTime + 0.4);
//     }
//   } catch (error) {
//     console.log("Beep sequence failed:", error);
//   }
// }

// // Create custom blue dot icon for user location
// export const createUserLocationIcon = () => {
//   if (!window.L) return null;
  
//   return window.L.divIcon({
//     className: 'user-location-marker',
//     html: `
//       <div class="user-location-dot">
//         <div class="user-location-pulse"></div>
//         <div class="user-location-inner"></div>
//       </div>
//     `,
//     iconSize: [20, 20],
//     iconAnchor: [10, 10]
//   });
// };

// // Create custom red dot icon for alarm locations
// export const createAlarmIcon = (triggered = false) => {
//   if (!window.L) return null;
  
//   return window.L.divIcon({
//     className: 'alarm-location-marker',
//     html: `
//       <div class="alarm-location-dot ${triggered ? 'triggered' : ''}">
//         <div class="alarm-location-inner"></div>
//       </div>
//     `,
//     iconSize: [16, 16],
//     iconAnchor: [8, 8]
//   });
// };

// // Search for locations using Nominatim (OpenStreetMap) geocoding service
// export const searchLocation = async (query) => {
//   try {
//     const response = await fetch(
//       `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=&addressdetails=1`
//     );
    
//     if (!response.ok) {
//       throw new Error('Search request failed');
//     }
    
//     const data = await response.json();
//     return data;
//   } catch (error) {
//     console.error('Geocoding error:', error);
//     throw error;
//   }
// };

// // Cleanup function to call when component unmounts
// export const cleanupLocationTracking = () => {
//   if (locationWatchId) {
//     navigator.geolocation.clearWatch(locationWatchId);
//     locationWatchId = null;
//   }
//   if (backgroundLocationInterval) {
//     clearInterval(backgroundLocationInterval);
//     backgroundLocationInterval = null;
//   }
//   releaseWakeLock();
// };

// Enhanced background location tracking utilities with cleaner logging
let wakeLock = null;
let locationWatchId = null;
let backgroundLocationInterval = null;
let isBackgroundMode = false;
let lastLoggedLocation = null;
let logInterval = 60000; // Log location every 60 seconds instead of every update

// Initialize audio on first user interaction (mobile requirement)
export const initializeAudio = async (audioInitialized, soundEnabled) => {
  if (audioInitialized || !soundEnabled) return audioInitialized;
  
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
      
      console.log('✅ Audio initialized successfully');
      return true;
    }
  } catch (error) {
    console.log('❌ Audio initialization failed:', error);
  }
  return false;
};

// Request wake lock to keep screen active (optional, user preference)
export const requestWakeLock = async () => {
  try {
    if ('wakeLock' in navigator) {
      wakeLock = await navigator.wakeLock.request('screen');
      console.log('🔒 Screen wake lock acquired');
      
      wakeLock.addEventListener('release', () => {
        console.log('🔓 Screen wake lock released');
        wakeLock = null;
      });
      
      return true;
    }
  } catch (error) {
    console.error('❌ Wake lock failed:', error);
  }
  return false;
};

// Release wake lock
export const releaseWakeLock = () => {
  if (wakeLock) {
    wakeLock.release();
    wakeLock = null;
  }
};

// Check if we should log location (to reduce console spam)
const shouldLogLocation = (location) => {
  const now = Date.now();
  const locationKey = `${location[0].toFixed(6)},${location[1].toFixed(6)}`;
  
  if (!lastLoggedLocation || (now - lastLoggedLocation.timestamp) > logInterval) {
    lastLoggedLocation = { timestamp: now, location: locationKey };
    return true;
  }
  
  return false;
};

// Enhanced location access with background tracking
export const requestLocationAccess = (setIsTracking, setUserLocation, onError) => {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by this browser');
    return;
  }

  // Clear any existing watchers
  if (locationWatchId) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
  
  if (backgroundLocationInterval) {
    clearInterval(backgroundLocationInterval);
    backgroundLocationInterval = null;
  }

  setIsTracking(true);
  console.log('📍 Starting location tracking...');
  
  // High accuracy options for active tracking
  const highAccuracyOptions = {
    enableHighAccuracy: true,
    timeout: 10000,
    maximumAge: 5000
  };

  // Lower power options for background tracking
  const backgroundOptions = {
    enableHighAccuracy: false,
    timeout: 30000,
    maximumAge: 60000
  };

  const successCallback = (position) => {
    try {
      if (position && position.coords) {
        const newLocation = [position.coords.latitude, position.coords.longitude];
        setUserLocation(newLocation);
        setIsTracking(true);
        
        // Only log occasionally to reduce console spam
        if (shouldLogLocation(newLocation)) {
          console.log(`📍 Location: ${newLocation[0].toFixed(6)}, ${newLocation[1].toFixed(6)} (accuracy: ${position.coords.accuracy?.toFixed(0)}m)`);
        }
      }
    } catch (error) {
      console.error("❌ Error processing location:", error);
      onError();
    }
  };

  const errorCallback = (error) => {
    console.warn("⚠️ Location error:", error.message);
    
    // Don't immediately fail - try background mode
    if (!isBackgroundMode) {
      startBackgroundLocationTracking(setUserLocation, setIsTracking);
    }
    
    // Show user-friendly error messages only for critical errors
    if (error.code === 1) { // PERMISSION_DENIED
      alert("Please enable location access in your browser settings.");
      onError();
    }
    // For other errors, continue with background tracking
  };

  try {
    // Start primary location watching
    locationWatchId = navigator.geolocation.watchPosition(
      successCallback,
      errorCallback,
      highAccuracyOptions
    );

    // Set up background tracking as backup
    startBackgroundLocationTracking(setUserLocation, setIsTracking);

    // Set up visibility change handlers
    setupBackgroundHandlers(setUserLocation, setIsTracking);

    return () => {
      if (locationWatchId) {
        navigator.geolocation.clearWatch(locationWatchId);
        locationWatchId = null;
      }
      if (backgroundLocationInterval) {
        clearInterval(backgroundLocationInterval);
        backgroundLocationInterval = null;
      }
      releaseWakeLock();
      console.log('🛑 Location tracking stopped');
    };
  } catch (error) {
    console.error("❌ Error setting up location tracking:", error);
    onError();
  }
};

// Background location tracking with intervals
const startBackgroundLocationTracking = (setUserLocation, setIsTracking) => {
  if (backgroundLocationInterval) return;
  
  // Only log when starting background tracking
  console.log('🌙 Background location tracking started');
  
  const backgroundOptions = {
    enableHighAccuracy: false,
    timeout: 30000,
    maximumAge: 30000
  };

  backgroundLocationInterval = setInterval(() => {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        if (position && position.coords) {
          const newLocation = [position.coords.latitude, position.coords.longitude];
          setUserLocation(newLocation);
          setIsTracking(true);
          
          // Only log background updates occasionally
          if (shouldLogLocation(newLocation)) {
            console.log(`🌙 Background: ${newLocation[0].toFixed(6)}, ${newLocation[1].toFixed(6)}`);
          }
        }
      },
      (error) => {
        // Only log significant background errors
        if (error.code === 1) { // Permission denied
          console.warn('❌ Background location permission denied');
        }
        // Silently continue for other errors
      },
      backgroundOptions
    );
  }, 30000); // Update every 30 seconds in background
};

// Setup handlers for page visibility changes
const setupBackgroundHandlers = (setUserLocation, setIsTracking) => {
  // Handle page visibility changes
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      if (!isBackgroundMode) {
        console.log('👁️ App backgrounded - maintaining tracking');
        isBackgroundMode = true;
      }
    } else {
      if (isBackgroundMode) {
        console.log('👁️ App focused - active tracking resumed');
        isBackgroundMode = false;
      }
    }
  });

  // Handle window focus/blur with reduced logging
  let lastBlurLog = 0;
  let lastFocusLog = 0;
  const logCooldown = 5000; // Only log once every 5 seconds

  window.addEventListener('blur', () => {
    const now = Date.now();
    if (now - lastBlurLog > logCooldown) {
      console.log('🌙 Window backgrounded');
      lastBlurLog = now;
    }
    isBackgroundMode = true;
  });

  window.addEventListener('focus', () => {
    const now = Date.now();
    if (now - lastFocusLog > logCooldown) {
      console.log('☀️ Window focused');
      lastFocusLog = now;
    }
    isBackgroundMode = false;
  });

  // Service Worker registration for background sync (if available)
  if ('serviceWorker' in navigator) {
    registerServiceWorker();
  }
};

// Register service worker for background processing
const registerServiceWorker = async () => {
  try {
    const registration = await navigator.serviceWorker.register('/sw.js');
    console.log('⚙️ Service Worker registered successfully');
  } catch (error) {
    console.log('⚠️ Service Worker registration failed:', error.message);
  }
};

// Calculate distance between two coordinates
export function getDistance(loc1, loc2) {
  try {
    if (!loc1 || !loc2 || !Array.isArray(loc1) || !Array.isArray(loc2)) {
      console.warn("⚠️ Invalid locations for distance calculation");
      return Infinity;
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
    console.error("❌ Error calculating distance:", error);
    return Infinity;
  }
}

// Enhanced voice alert function with background support
export function playVoiceAlert(alarmName) {
  try {
    console.log(`🚨 ALARM TRIGGERED: ${alarmName}`);
    
    // Method 1: Speech Synthesis (works best on mobile)
    if ('speechSynthesis' in window) {
      speechSynthesis.cancel();
      
      // Play voice alert 3 times with background-friendly settings
      for (let i = 0; i < 3; i++) {
        setTimeout(() => {
          const utterance = new SpeechSynthesisUtterance(`Alarm triggered. You have reached ${alarmName}`);
          utterance.rate = 1.2;
          utterance.volume = 1.0;
          utterance.pitch = 1.0;
          
          utterance.onerror = (event) => {
            if (i === 0) { // Only log first error to avoid spam
              console.log('⚠️ Speech synthesis error, using backup sound');
            }
            playBackupSound();
          };
          
          speechSynthesis.speak(utterance);
        }, i * 2000);
      }
    }
    
    // Method 2: Backup sound (beeps)
    setTimeout(() => {
      playBackupSound();
    }, 500);

    // Method 3: Vibration if available
    if ('vibrate' in navigator) {
      navigator.vibrate([500, 200, 500, 200, 500]);
      console.log('📳 Vibration triggered');
    }
    
  } catch (error) {
    console.log("❌ Voice alert failed:", error);
    playBackupSound();
  }
}

// Backup sound method with enhanced compatibility
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
    console.log("⚠️ Backup sound failed:", error);
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
      
      oscillator.frequency.setValueAtTime(1200, startTime);
      gainNode.gain.setValueAtTime(0.5, startTime);
      gainNode.gain.exponentialRampToValueAtTime(0.01, startTime + 0.4);
      
      oscillator.start(startTime);
      oscillator.stop(startTime + 0.4);
    }
  } catch (error) {
    console.log("⚠️ Beep sequence failed:", error);
  }
}

// Create custom blue dot icon for user location
export const createUserLocationIcon = () => {
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
export const createAlarmIcon = (triggered = false) => {
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

// Search for locations using Nominatim (OpenStreetMap) geocoding service
export const searchLocation = async (query) => {
  try {
    const response = await fetch(
      `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=5&countrycodes=&addressdetails=1`
    );
    
    if (!response.ok) {
      throw new Error('Search request failed');
    }
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('❌ Geocoding error:', error);
    throw error;
  }
};

// Cleanup function to call when component unmounts
export const cleanupLocationTracking = () => {
  if (locationWatchId) {
    navigator.geolocation.clearWatch(locationWatchId);
    locationWatchId = null;
  }
  if (backgroundLocationInterval) {
    clearInterval(backgroundLocationInterval);
    backgroundLocationInterval = null;
  }
  releaseWakeLock();
  console.log('🛑 Location tracking cleaned up');
};