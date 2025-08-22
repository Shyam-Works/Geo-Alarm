// getUtils.js - Enhanced version with better iOS compatibility and audio handling

let audioContext = null;
let audioInitialized = false;
let userInteracted = false;
let pendingAudioMessage = null;
let speechQueue = [];
let isSpeaking = false;
let fallbackAudio = null;

// Detect iOS more comprehensively
const isIOS = () => {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || 
         (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
};

// iOS-specific audio context creation
function createAudioContext() {
  try {
    // Use webkitAudioContext for older iOS Safari
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      console.warn('Web Audio API not supported');
      return null;
    }
    
    const context = new AudioContextClass();
    
    // Resume context if suspended (iOS requirement)
    if (context.state === 'suspended') {
      context.resume().catch(error => {
        console.warn('Failed to resume audio context immediately:', error);
      });
    }
    
    return context;
  } catch (error) {
    console.error('Failed to create audio context:', error);
    return null;
  }
}

// Enhanced speech synthesis with iOS fallbacks and queue management
function speakText(text, priority = false, retryCount = 0) {
  return new Promise((resolve, reject) => {
    try {
      // Check if speech synthesis is available
      if (!('speechSynthesis' in window)) {
        console.warn('Speech synthesis not supported');
        playFallbackSound();
        resolve();
        return;
      }

      // For iOS, ensure we're not already speaking
      if (isIOS() && window.speechSynthesis.speaking) {
        if (priority) {
          window.speechSynthesis.cancel();
          // Wait a bit before speaking
          setTimeout(() => speakText(text, priority, retryCount).then(resolve).catch(reject), 200);
          return;
        } else {
          // Queue the message
          speechQueue.push({ text, resolve, reject, retryCount });
          return;
        }
      }

      // Cancel any ongoing speech for priority messages
      if (priority) {
        window.speechSynthesis.cancel();
      }
      
      // Create utterance
      const utterance = new SpeechSynthesisUtterance(text);
      
      // iOS-specific settings for better compatibility
      if (isIOS()) {
        utterance.rate = 0.8; // Slower rate for iOS
        utterance.pitch = 1.1;
        utterance.volume = 0.9;
        utterance.lang = 'en-US';
        
        // Try to use a specific voice that works well on iOS
        const voices = window.speechSynthesis.getVoices();
        const preferredVoice = voices.find(voice => 
          voice.lang.startsWith('en') && 
          (voice.name.includes('Samantha') || voice.name.includes('Alex') || voice.default)
        );
        if (preferredVoice) {
          utterance.voice = preferredVoice;
        }
      } else {
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;
        utterance.lang = 'en-US';
      }
      
      let hasStarted = false;
      let hasEnded = false;
      let timeoutId;
      
      utterance.onstart = () => {
        hasStarted = true;
        isSpeaking = true;
        console.log('Speech started:', text);
        if (timeoutId) clearTimeout(timeoutId);
      };
      
      utterance.onend = () => {
        if (hasEnded) return; // Prevent double execution
        hasEnded = true;
        isSpeaking = false;
        console.log('Speech ended:', text);
        if (timeoutId) clearTimeout(timeoutId);
        
        // Process speech queue
        if (speechQueue.length > 0) {
          const next = speechQueue.shift();
          setTimeout(() => {
            speakText(next.text, false, next.retryCount).then(next.resolve).catch(next.reject);
          }, isIOS() ? 500 : 200);
        }
        
        resolve();
      };
      
      utterance.onerror = (event) => {
        hasEnded = true;
        isSpeaking = false;
        console.error('Speech error:', event.error, 'for text:', text);
        if (timeoutId) clearTimeout(timeoutId);
        
        // Handle iOS-specific errors
        if (isIOS() && (event.error === 'network' || event.error === 'synthesis-failed' || event.error === 'audio-busy')) {
          if (retryCount < 3) {
            console.log(`iOS speech retry attempt ${retryCount + 1} for:`, text);
            setTimeout(() => {
              speakText(text, priority, retryCount + 1).then(resolve).catch(reject);
            }, 1000 * (retryCount + 1)); // Exponential backoff
            return;
          }
        }
        
        // Other error handling
        if (event.error === 'network' || event.error === 'synthesis-unavailable') {
          if (retryCount < 2) {
            console.log(`Retrying speech, attempt ${retryCount + 1}`);
            setTimeout(() => {
              speakText(text, priority, retryCount + 1).then(resolve).catch(reject);
            }, 800);
            return;
          }
        }
        
        // Fallback to beep sound
        playFallbackSound();
        resolve();
      };
      
      // iOS Safari timeout fallback - longer timeout for iOS
      const timeoutDuration = isIOS() ? 8000 : 5000;
      timeoutId = setTimeout(() => {
        if (!hasStarted && !hasEnded) {
          console.warn(`Speech synthesis timeout (${timeoutDuration}ms) for:`, text);
          window.speechSynthesis.cancel();
          hasEnded = true;
          isSpeaking = false;
          playFallbackSound();
          resolve();
        }
      }, timeoutDuration);
      
      // For iOS, we need to wait a bit before speaking and ensure the utterance is fresh
      if (isIOS()) {
        setTimeout(() => {
          if (!hasEnded) {
            try {
              window.speechSynthesis.speak(utterance);
            } catch (error) {
              console.error('Failed to speak on iOS:', error);
              playFallbackSound();
              hasEnded = true;
              resolve();
            }
          }
        }, 200);
      } else {
        window.speechSynthesis.speak(utterance);
      }
      
    } catch (error) {
      console.error('Speech synthesis failed:', error);
      isSpeaking = false;
      playFallbackSound();
      resolve();
    }
  });
}

// Enhanced fallback sound with multiple strategies
function playFallbackSound() {
  console.log('Playing fallback sound');
  
  // Try multiple fallback strategies
  const strategies = [
    () => playWebAudioBeep(),
    () => playHtmlAudioBeep(),
    () => playOscillatorBeep(),
    () => playDataUriBeep()
  ];
  
  // Try each strategy until one works
  for (const strategy of strategies) {
    try {
      strategy();
      return; // If successful, exit
    } catch (error) {
      console.warn('Fallback sound strategy failed:', error);
      continue;
    }
  }
  
  console.warn('All fallback sound strategies failed');
}

// Web Audio API beep sound - enhanced for iOS
function playWebAudioBeep() {
  if (!audioContext) return false;
  
  try {
    // Ensure context is running
    if (audioContext.state === 'suspended') {
      audioContext.resume();
    }
    
    if (audioContext.state !== 'running') {
      throw new Error('AudioContext not running');
    }
    
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    // Create a distinctive alarm sound pattern
    oscillator.frequency.setValueAtTime(800, audioContext.currentTime);
    oscillator.type = 'sine';
    
    gainNode.gain.setValueAtTime(0, audioContext.currentTime);
    gainNode.gain.linearRampToValueAtTime(0.4, audioContext.currentTime + 0.1);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.6);
    
    oscillator.start(audioContext.currentTime);
    oscillator.stop(audioContext.currentTime + 0.6);
    
    // Add a second beep for iOS recognition
    setTimeout(() => {
      try {
        const oscillator2 = audioContext.createOscillator();
        const gainNode2 = audioContext.createGain();
        
        oscillator2.connect(gainNode2);
        gainNode2.connect(audioContext.destination);
        
        oscillator2.frequency.setValueAtTime(1000, audioContext.currentTime);
        oscillator2.type = 'sine';
        
        gainNode2.gain.setValueAtTime(0, audioContext.currentTime);
        gainNode2.gain.linearRampToValueAtTime(0.4, audioContext.currentTime + 0.1);
        gainNode2.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);
        
        oscillator2.start(audioContext.currentTime);
        oscillator2.stop(audioContext.currentTime + 0.5);
      } catch (error) {
        console.warn('Second beep failed:', error);
      }
    }, 200);
    
    return true;
    
  } catch (error) {
    console.error('Web Audio beep failed:', error);
    return false;
  }
}

// HTML5 Audio beep with data URI
function playHtmlAudioBeep() {
  try {
    const audio = new Audio();
    
    // Enhanced beep sound data URI - longer and more distinctive
    const beepDataUri = 'data:audio/wav;base64,UklGRnoGAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQoGAACBhYqFbF1fdJivrJBhNjVgodDbq2EcBj+a2/LDciUFLIHO8tiJNwgZaLvt559NEAxQp+PwtmMcBjiR1/LMeSwFJHfH8N2QQAoUXrTp66hVFApGn+DyvmYeBjmF2vy0eB8ABJ+9rDFgIwIZp9tz4nQdBgqt6+yNRAkbdNa+yGorAA==';
    
    audio.src = beepDataUri;
    audio.volume = 0.8;
    audio.preload = 'auto';
    
    const playPromise = audio.play();
    if (playPromise !== undefined) {
      playPromise.catch(error => {
        console.warn('HTML5 audio beep failed:', error);
        throw error;
      });
    }
    
    return true;
    
  } catch (error) {
    console.error('HTML5 audio beep failed:', error);
    return false;
  }
}

// Simple oscillator beep for iOS
function playOscillatorBeep() {
  if (!audioContext || audioContext.state !== 'running') {
    throw new Error('AudioContext not available');
  }
  
  try {
    const oscillator = audioContext.createOscillator();
    const gainNode = audioContext.createGain();
    
    oscillator.connect(gainNode);
    gainNode.connect(audioContext.destination);
    
    oscillator.frequency.value = 880; // A note
    oscillator.type = 'square'; // More distinctive than sine
    
    gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.8);
    
    oscillator.start();
    oscillator.stop(audioContext.currentTime + 0.8);
    
    return true;
    
  } catch (error) {
    console.error('Oscillator beep failed:', error);
    return false;
  }
}

// Data URI beep using Web Audio API buffer
function playDataUriBeep() {
  if (!audioContext || audioContext.state !== 'running') {
    throw new Error('AudioContext not available');
  }
  
  try {
    // Create a simple beep using audio buffer
    const sampleRate = audioContext.sampleRate;
    const duration = 0.5;
    const buffer = audioContext.createBuffer(1, sampleRate * duration, sampleRate);
    const channelData = buffer.getChannelData(0);
    
    // Generate a beep tone
    for (let i = 0; i < buffer.length; i++) {
      const t = i / sampleRate;
      channelData[i] = Math.sin(2 * Math.PI * 880 * t) * Math.exp(-t * 3);
    }
    
    const source = audioContext.createBufferSource();
    source.buffer = buffer;
    source.connect(audioContext.destination);
    source.start();
    
    return true;
    
  } catch (error) {
    console.error('Data URI beep failed:', error);
    return false;
  }
}

// Enhanced audio initialization with comprehensive iOS support
export async function initializeAudio(currentlyInitialized, soundEnabled) {
  if (!soundEnabled) {
    console.log('Sound disabled, skipping audio initialization');
    return false;
  }
  
  if (currentlyInitialized && audioContext && audioContext.state === 'running') {
    console.log('Audio already initialized and running');
    return true;
  }
  
  try {
    console.log('Initializing audio system...');
    
    // Mark user interaction
    userInteracted = true;
    
    // Create or resume audio context
    if (!audioContext) {
      audioContext = createAudioContext();
      if (!audioContext) {
        throw new Error('Failed to create AudioContext');
      }
    }
    
    // Resume context if suspended
    if (audioContext.state === 'suspended') {
      console.log('Resuming suspended AudioContext...');
      await audioContext.resume();
      
      // Wait a bit for iOS
      if (isIOS()) {
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }
    
    if (audioContext.state !== 'running') {
      throw new Error(`AudioContext state is ${audioContext.state}, expected running`);
    }
    
    // Test speech synthesis availability
    if ('speechSynthesis' in window) {
      console.log('Testing speech synthesis...');
      
      // Cancel any ongoing speech
      window.speechSynthesis.cancel();
      
      // For iOS, wait for voices to load
      if (isIOS()) {
        let voices = window.speechSynthesis.getVoices();
        if (voices.length === 0) {
          console.log('Waiting for iOS voices to load...');
          await new Promise((resolve) => {
            let attempts = 0;
            const checkVoices = () => {
              voices = window.speechSynthesis.getVoices();
              attempts++;
              if (voices.length > 0 || attempts > 10) {
                resolve();
              } else {
                setTimeout(checkVoices, 200);
              }
            };
            
            // Listen for voice change event
            const voicesChanged = () => {
              window.speechSynthesis.removeEventListener('voiceschanged', voicesChanged);
              resolve();
            };
            window.speechSynthesis.addEventListener('voiceschanged', voicesChanged);
            
            checkVoices();
          });
        }
        
        console.log(`Found ${voices.length} voices for iOS`);
      }
      
      // Test with a very short phrase
      await speakText('Ready', true);
    }
    
    // Test Web Audio API
    console.log('Testing Web Audio API...');
    playWebAudioBeep();
    
    audioInitialized = true;
    console.log('Audio system initialized successfully');
    
    // Play any pending audio message
    if (pendingAudioMessage) {
      const message = pendingAudioMessage;
      pendingAudioMessage = null;
      setTimeout(() => speakText(message, true), isIOS() ? 800 : 500);
    }
    
    return true;
    
  } catch (error) {
    console.error('Audio initialization failed:', error);
    audioInitialized = false;
    
    // Try basic fallback
    try {
      playFallbackSound();
    } catch (fallbackError) {
      console.error('Even fallback sound failed:', fallbackError);
    }
    
    return false;
  }
}

// Enhanced voice alert with comprehensive iOS support
export async function playVoiceAlert(locationName) {
  console.log('playVoiceAlert called:', locationName, 'audioInitialized:', audioInitialized, 'userInteracted:', userInteracted);
  
  const message = `Geo alarm triggered. You have reached ${locationName}`;
  
  // If audio not initialized but user has interacted, try to initialize
  if (!audioInitialized && userInteracted) {
    console.log('Attempting to initialize audio for alert...');
    try {
      const initialized = await initializeAudio(false, true);
      if (initialized) {
        audioInitialized = true;
      }
    } catch (error) {
      console.error('Failed to initialize audio during alert:', error);
    }
  }
  
  // If still not initialized, store message and play fallback
  if (!audioInitialized) {
    console.log('Audio not initialized, storing message and playing fallback');
    pendingAudioMessage = message;
    playFallbackSound();
    return;
  }
  
  // Resume audio context if suspended
  if (audioContext && audioContext.state === 'suspended') {
    try {
      console.log('Resuming audio context for alert...');
      await audioContext.resume();
      
      // Wait for iOS
      if (isIOS()) {
        await new Promise(resolve => setTimeout(resolve, 300));
      }
    } catch (error) {
      console.error('Failed to resume audio context:', error);
    }
  }
  
  try {
    // Play with high priority to interrupt any ongoing speech
    await speakText(message, true);
    console.log('Voice alert played successfully');
    
  } catch (error) {
    console.error('Voice alert failed, playing fallback:', error);
    playFallbackSound();
  }
}

// Enhanced location access with iOS-specific handling
export function requestLocationAccess(setIsTracking, setUserLocation, onError) {
  if (!navigator.geolocation) {
    alert('Geolocation is not supported by this browser.');
    return;
  }

  console.log('Requesting location access...');
  setIsTracking(true);
  
  // Mark user interaction for audio
  userInteracted = true;

  // iOS-optimized options
  const options = {
    enableHighAccuracy: true,
    timeout: isIOS() ? 20000 : 12000, // Longer timeout for iOS
    maximumAge: isIOS() ? 30000 : 60000 // Shorter max age for iOS for fresher readings
  };

  console.log('Geolocation options:', options);

  navigator.geolocation.getCurrentPosition(
    (position) => {
      const { latitude, longitude, accuracy } = position.coords;
      console.log(`Location acquired: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}, accuracy: ${accuracy}m`);
      
      setUserLocation([latitude, longitude]);
      
      // For iOS, try to get a better reading if accuracy is poor
      if (isIOS() && accuracy > 100) {
        console.log('iOS: Accuracy poor, requesting high-precision location...');
        navigator.geolocation.getCurrentPosition(
          (betterPosition) => {
            if (betterPosition.coords.accuracy < accuracy) {
              console.log(`Better location found: accuracy improved from ${accuracy}m to ${betterPosition.coords.accuracy}m`);
              setUserLocation([betterPosition.coords.latitude, betterPosition.coords.longitude]);
            }
          },
          (error) => {
            console.warn('High-precision location request failed:', error);
          },
          { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
        );
      }
    },
    (error) => {
      console.error('Location error:', error);
      setIsTracking(false);
      
      let errorMessage = 'Location access failed. ';
      switch (error.code) {
        case error.PERMISSION_DENIED:
          errorMessage += isIOS() 
            ? 'Permission denied. Please go to Settings > Privacy & Security > Location Services and enable location for this website.'
            : 'Permission denied. Please enable location access in your browser settings.';
          break;
        case error.POSITION_UNAVAILABLE:
          errorMessage += isIOS()
            ? 'Position unavailable. Please ensure Location Services is enabled and try moving to an area with better GPS reception.'
            : 'Position unavailable. Please check your GPS/network connection.';
          break;
        case error.TIMEOUT:
          errorMessage += isIOS()
            ? 'Request timed out. This can happen on iOS - please try again and keep the app open.'
            : 'Request timed out. Please try again.';
          break;
        default:
          errorMessage += 'An unknown error occurred.';
          break;
      }
      
      alert(errorMessage);
      if (onError) onError();
    },
    options
  );
}

// Enhanced distance calculation with validation
export function getDistance(pos1, pos2) {
  if (!pos1 || !pos2 || !Array.isArray(pos1) || !Array.isArray(pos2)) {
    return Infinity;
  }
  
  if (pos1.length < 2 || pos2.length < 2) {
    return Infinity;
  }
  
  const lat1 = parseFloat(pos1[0]);
  const lon1 = parseFloat(pos1[1]);
  const lat2 = parseFloat(pos2[0]);
  const lon2 = parseFloat(pos2[1]);
  
  if (isNaN(lat1) || isNaN(lon1) || isNaN(lat2) || isNaN(lon2)) {
    return Infinity;
  }
  
  const R = 6371e3; // Earth's radius in meters
  const φ1 = lat1 * Math.PI/180;
  const φ2 = lat2 * Math.PI/180;
  const Δφ = (lat2-lat1) * Math.PI/180;
  const Δλ = (lon2-lon1) * Math.PI/180;

  const a = Math.sin(Δφ/2) * Math.sin(Δφ/2) +
          Math.cos(φ1) * Math.cos(φ2) *
          Math.sin(Δλ/2) * Math.sin(Δλ/2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));

  return R * c;
}

// Create user location icon
export function createUserLocationIcon() {
  if (!window.L) return null;
  
  return window.L.divIcon({
    className: 'user-location-icon',
    html: `<div style="
      background: #3b82f6; 
      width: 20px; 
      height: 20px; 
      border-radius: 50%; 
      border: 3px solid white; 
      box-shadow: 0 2px 6px rgba(0,0,0,0.3);
      animation: pulse 2s infinite;
    "></div>
    <style>
      @keyframes pulse {
        0% { box-shadow: 0 2px 6px rgba(0,0,0,0.3), 0 0 0 0 rgba(59, 130, 246, 0.7); }
        70% { box-shadow: 0 2px 6px rgba(0,0,0,0.3), 0 0 0 10px rgba(59, 130, 246, 0); }
        100% { box-shadow: 0 2px 6px rgba(0,0,0,0.3), 0 0 0 0 rgba(59, 130, 246, 0); }
      }
    </style>`,
    iconSize: [26, 26],
    iconAnchor: [13, 13]
  });
}

// Create alarm icon with animation
export function createAlarmIcon(triggered = false) {
  if (!window.L) return null;
  
  const color = triggered ? '#ef4444' : '#fbbf24';
  const icon = triggered ? '🚨' : '🔔';
  const animation = triggered ? 'shake 0.5s infinite' : 'none';
  
  return window.L.divIcon({
    className: 'alarm-icon',
    html: `<div style="
      background: ${color}; 
      width: 30px; 
      height: 30px; 
      border-radius: 50%; 
      border: 3px solid white; 
      box-shadow: 0 2px 6px rgba(0,0,0,0.3); 
      display: flex; 
      align-items: center; 
      justify-content: center; 
      font-size: 16px;
      animation: ${animation};
    ">${icon}</div>
    <style>
      @keyframes shake {
        0%, 100% { transform: translateX(0); }
        25% { transform: translateX(-2px); }
        75% { transform: translateX(2px); }
      }
    </style>`,
    iconSize: [36, 36],
    iconAnchor: [18, 18]
  });
}

// Enhanced location search function with error handling
export async function searchLocation(query) {
  if (!query || typeof query !== 'string' || query.trim().length === 0) {
    throw new Error('Invalid search query');
  }

  try {
    const encodedQuery = encodeURIComponent(query.trim());
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodedQuery}&limit=10&addressdetails=1`;
    
    console.log('Searching for:', query);
    
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'GeoAlarm App'
      }
    });
    
    if (!response.ok) {
      throw new Error(`Search request failed with status ${response.status}`);
    }
    
    const results = await response.json();
    console.log(`Found ${results.length} results for "${query}"`);
    
    return results || [];
  } catch (error) {
    console.error('Search error:', error);
    throw error;
  }
}

// Add comprehensive event listeners for user interaction detection
if (typeof window !== 'undefined') {
  // Mark user interaction on various events
  const interactionEvents = ['touchstart', 'touchend', 'mousedown', 'mouseup', 'keydown', 'click'];
  
  interactionEvents.forEach(event => {
    document.addEventListener(event, () => {
      if (!userInteracted) {
        userInteracted = true;
        console.log('User interaction detected for audio via:', event);
        
        // Try to initialize audio context immediately on iOS
        if (isIOS() && !audioInitialized && audioContext && audioContext.state === 'suspended') {
          audioContext.resume().catch(error => {
            console.warn('Failed to resume audio context on interaction:', error);
          });
        }
      }
    }, { once: false, passive: true });
  });
  
  // Handle page visibility changes (important for iOS background behavior)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      console.log('Page became visible');
      
      if (audioContext && audioContext.state === 'suspended') {
        audioContext.resume().catch(error => {
          console.error('Failed to resume audio context on visibility change:', error);
        });
      }
      
      // Clear speech queue on page focus to avoid stale messages
      if (isIOS()) {
        speechQueue.length = 0;
        window.speechSynthesis.cancel();
        isSpeaking = false;
      }
    } else {
      console.log('Page became hidden');
      
      // On iOS, cancel speech when page becomes hidden
      if (isIOS()) {
        window.speechSynthesis.cancel();
        isSpeaking = false;
      }
    }
  });
  
  // Handle iOS-specific audio interruptions
  if (isIOS() && 'speechSynthesis' in window) {
    // Handle speech synthesis pause/resume events
    window.addEventListener('pagehide', () => {
      window.speechSynthesis.cancel();
      speechQueue.length = 0;
      isSpeaking = false;
    });
    
    window.addEventListener('pageshow', (event) => {
      if (event.persisted) {
        // Page was restored from cache
        window.speechSynthesis.cancel();
        speechQueue.length = 0;
        isSpeaking = false;
      }
    });
  }
}
