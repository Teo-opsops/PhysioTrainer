// ══════════════════════════════════════════════════════════
//  Google Auth & Drive Sync (PhysioTrainer)
//  Merge strategy: ID-based per-item merge with updatedAt
//  for exercises & workouts. Sessions are unioned by ID
//  (they're append-only). Exactly mirrors Notes' approach.
// ══════════════════════════════════════════════════════════

var GOOGLE_CLIENT_ID = '662885517517-vub0f92dpv1765ckf02nn3ubpgqtpa25.apps.googleusercontent.com';
var DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
var DRIVE_FILE_NAME = 'physiotrainer_app_data.json';

var googleAccessToken = null;
var googleUser = null;
var driveFileId = null;
var isSyncing = false;
var tokenClient = null;

// DOM references (re-attached dynamically since PT re-renders settings)
var googleSignedOut, googleSignedIn, googleSigninBtn, googleSignoutBtn;
var profileAvatar, profileName, profileEmail, syncNowBtn, syncStatusEl;
var syncConflictOverlay, syncUseCloud, syncUseLocal, syncLocalCount, syncCloudCount;
var pendingDriveData = null;

function now() { return new Date().toISOString(); }

// ── Token persistence ──
function saveTokenToStorage(accessToken, expiresIn) {
  var expiryTime = Date.now() + (expiresIn * 1000) - 60000;
  localStorage.setItem('physioGoogleToken', JSON.stringify({ token: accessToken, expiry: expiryTime }));
}

function loadTokenFromStorage(returnFullData) {
  try {
    var saved = localStorage.getItem('physioGoogleToken');
    if (!saved) return null;
    var parsed = JSON.parse(saved);
    if (parsed.token && parsed.expiry && Date.now() < parsed.expiry) {
      return returnFullData === true ? parsed : parsed.token;
    }
    localStorage.removeItem('physioGoogleToken');
    return null;
  } catch (e) {
    localStorage.removeItem('physioGoogleToken');
    return null;
  }
}

function clearTokenFromStorage() {
  localStorage.removeItem('physioGoogleToken');
}

// ── Silent token refresh via GAPI iframe ──
function silentRefreshViaGapi(email) {
  return new Promise(function (resolve, reject) {
    if (typeof gapi === 'undefined') return reject(new Error('GAPI not loaded'));
    var authLoaded = false;
    var loadTimeout = setTimeout(function () {
      if (!authLoaded) reject(new Error('GAPI auth load timeout'));
    }, 8000);

    gapi.load('auth', {
      callback: function () {
        authLoaded = true;
        clearTimeout(loadTimeout);
        gapi.auth.authorize({
          client_id: GOOGLE_CLIENT_ID,
          scope: DRIVE_SCOPE + ' https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
          immediate: true,
          login_hint: email
        }, function (authResult) {
          if (authResult && !authResult.error && authResult.access_token) {
            resolve({ access_token: authResult.access_token, expires_in: parseInt(authResult.expires_in) || 3600 });
          } else {
            reject(new Error(authResult ? authResult.error : 'Silent auth failed'));
          }
        });
      },
      onerror: function () {
        clearTimeout(loadTimeout);
        reject(new Error('Failed to load GAPI auth module'));
      }
    });
  });
}

// ── Predictive token refresh ──
var tokenRefreshTimer = null;
function schedulePredictiveTokenRefresh(expiresInSec) {
  if (tokenRefreshTimer) clearTimeout(tokenRefreshTimer);
  var refreshDelayMs = (expiresInSec - 300) * 1000;
  if (refreshDelayMs <= 0) refreshDelayMs = 10000;
  tokenRefreshTimer = setTimeout(function() {
    if (googleUser && googleUser.email) {
      silentRefreshViaGapi(googleUser.email).then(function (result) {
        googleAccessToken = result.access_token;
        saveTokenToStorage(result.access_token, result.expires_in || 3600);
        schedulePredictiveTokenRefresh(result.expires_in || 3600);
      }).catch(function () {});
    }
  }, refreshDelayMs);
}

// ── Dynamic UI attachment (PhysioTrainer re-renders the settings view) ──
function attachUIListeners() {
  googleSignedOut = document.getElementById('google-signed-out');
  googleSignedIn = document.getElementById('google-signed-in');
  googleSigninBtn = document.getElementById('google-signin-btn');
  googleSignoutBtn = document.getElementById('google-signout-btn');
  profileAvatar = document.getElementById('profile-avatar');
  profileName = document.getElementById('profile-name');
  profileEmail = document.getElementById('profile-email');
  syncNowBtn = document.getElementById('sync-now-btn');
  syncStatusEl = document.getElementById('sync-status');
  syncConflictOverlay = document.getElementById('sync-conflict-overlay');
  syncUseCloud = document.getElementById('sync-use-cloud');
  syncUseLocal = document.getElementById('sync-use-local');
  syncLocalCount = document.getElementById('sync-local-count');
  syncCloudCount = document.getElementById('sync-cloud-count');

  if (googleSigninBtn) {
    googleSigninBtn.onclick = function () {
      if (!tokenClient) return alert('Le librerie Google non sono ancora caricate. Riprova tra un momento.');
      tokenClient.requestAccessToken();
    };
  }
  if (googleSignoutBtn) {
    googleSignoutBtn.onclick = function () {
      if (googleAccessToken) google.accounts.oauth2.revoke(googleAccessToken, function () {});
      googleAccessToken = null; googleUser = null; driveFileId = null;
      localStorage.removeItem('physioGoogleUser'); clearTokenFromStorage();
      localStorage.removeItem('physioLastSync'); localStorage.removeItem('physioDriveFileId');
      showSignedOutUI();
    };
  }
  if (syncNowBtn) {
    syncNowBtn.onclick = function () {
      if (!googleAccessToken && googleUser) {
        tokenClient.requestAccessToken({ prompt: '', login_hint: googleUser.email || '' });
        return;
      }
      syncWithDrive(false);
    };
  }
  if (syncUseCloud) {
    syncUseCloud.onclick = function () {
      if (pendingDriveData) {
        setLocalData(pendingDriveData);
        localStorage.setItem('physioLastSync', now());
        updateSyncStatus('Sincronizzato ✓', '');
      }
      if (syncConflictOverlay) syncConflictOverlay.style.display = 'none';
      pendingDriveData = null;
    };
  }
  if (syncUseLocal) {
    syncUseLocal.onclick = function () {
      if (syncConflictOverlay) syncConflictOverlay.style.display = 'none';
      pendingDriveData = null;
      writeDriveFile(getLocalData() || {}).then(function () {
        localStorage.setItem('physioLastSync', now());
        updateSyncStatus('Sincronizzato ✓', '');
      });
    };
  }

  if (googleUser) showSignedInUI();
  else showSignedOutUI();
}

// Re-attach when settings view is rendered
var uiAttachInterval = setInterval(function() {
  if (document.getElementById('google-signin-btn') && (!googleSigninBtn || !document.contains(googleSigninBtn))) {
    attachUIListeners();
  }
}, 1000);

// ── Init ──
function initGoogleAuth() {
  if (typeof google === 'undefined' || !google.accounts) {
    var gScript = document.querySelector('script[src*="accounts.google.com/gsi/client"]');
    if (gScript && !gScript.dataset.hooked) {
      gScript.dataset.hooked = 'true';
      gScript.addEventListener('load', initGoogleAuth);
    } else if (!gScript) {
      setTimeout(initGoogleAuth, 500);
    }
    return;
  }

  tokenClient = google.accounts.oauth2.initTokenClient({
    client_id: GOOGLE_CLIENT_ID,
    scope: DRIVE_SCOPE + ' https://www.googleapis.com/auth/userinfo.profile https://www.googleapis.com/auth/userinfo.email',
    callback: handleTokenResponse
  });

  var savedUser = localStorage.getItem('physioGoogleUser');
  if (savedUser) {
    try {
      googleUser = JSON.parse(savedUser);
      showSignedInUI();

      var storedTokenObj = loadTokenFromStorage(true);
      if (storedTokenObj && storedTokenObj.token) {
        googleAccessToken = storedTokenObj.token;
        var timeToExpireSec = Math.floor((storedTokenObj.expiry - Date.now()) / 1000);
        schedulePredictiveTokenRefresh(timeToExpireSec);
        if (localStorage.getItem('physioLastSync')) performStartupSync();
        else firstSyncCheck();
      } else {
        silentRefreshViaGapi(googleUser.email).then(function (result) {
          googleAccessToken = result.access_token;
          saveTokenToStorage(result.access_token, result.expires_in || 3600);
          if (localStorage.getItem('physioLastSync')) performStartupSync();
          else firstSyncCheck();
        }).catch(function () {
          updateSyncStatus('Tocca Sync per aggiornare', '');
        });
      }
    } catch (e) {
      localStorage.removeItem('physioGoogleUser');
      clearTokenFromStorage();
    }
  }
}

function handleTokenResponse(response) {
  if (response.error) return updateSyncStatus('Errore di autenticazione', 'error');
  googleAccessToken = response.access_token;
  saveTokenToStorage(response.access_token, response.expires_in || 3600);
  schedulePredictiveTokenRefresh(response.expires_in || 3600);

  fetch('https://www.googleapis.com/oauth2/v2/userinfo', { headers: { 'Authorization': 'Bearer ' + googleAccessToken } })
  .then(function (res) { return res.json(); })
  .then(function (user) {
    googleUser = { name: user.name, email: user.email, picture: user.picture };
    localStorage.setItem('physioGoogleUser', JSON.stringify(googleUser));
    showSignedInUI();
    if (user.picture) {
      var img = new Image();
      img.crossOrigin = 'Anonymous';
      img.onload = function() {
        var cvs = document.createElement('canvas');
        cvs.width = img.width; cvs.height = img.height;
        cvs.getContext('2d').drawImage(img, 0, 0);
        try {
          googleUser.picture = cvs.toDataURL('image/jpeg', 0.8);
          localStorage.setItem('physioGoogleUser', JSON.stringify(googleUser));
          if (profileAvatar) profileAvatar.src = googleUser.picture;
        } catch (e) {}
      };
      img.src = user.picture;
    }
    setTimeout(function() {
      if (localStorage.getItem('physioLastSync')) performStartupSync();
      else firstSyncCheck();
    }, 0);
  });
}

// ── UI ──
function showSignedInUI() {
  if (googleSignedOut) googleSignedOut.style.display = 'none';
  if (googleSignedIn) googleSignedIn.style.display = '';
  if (googleUser && profileName) {
    profileName.textContent = googleUser.name || '';
    profileEmail.textContent = googleUser.email || '';
    if (profileAvatar) {
      profileAvatar.src = googleUser.picture || '';
      profileAvatar.style.display = googleUser.picture ? '' : 'none';
    }
  }
}

function showSignedOutUI() {
  if (googleSignedOut) googleSignedOut.style.display = '';
  if (googleSignedIn) googleSignedIn.style.display = 'none';
  updateSyncStatus('Non sincronizzato', '');
}

function updateSyncStatus(text, st) {
  if (!syncStatusEl) return;
  syncStatusEl.textContent = text;
  syncStatusEl.style.color = st === 'error' ? '#ef4444' : st === 'syncing' ? 'var(--accent-primary)' : 'var(--text-secondary)';
}

// ── Drive helpers ──
function ensureToken() {
  return new Promise(function (resolve, reject) {
    if (googleAccessToken) {
      var validToken = loadTokenFromStorage();
      if (validToken) resolve(validToken);
      else { googleAccessToken = null; reject(new Error('Token expired.')); }
    } else reject(new Error('No token.'));
  });
}

function driveFetch(url, options) {
  options = options || {};
  options.headers = options.headers || {};
  options.headers['Authorization'] = 'Bearer ' + googleAccessToken;
  if (typeof options.keepalive === 'undefined') options.keepalive = true;
  return fetch(url, options);
}

function findDriveFile() {
  if (driveFileId) return Promise.resolve({ id: driveFileId });
  var savedId = localStorage.getItem('physioDriveFileId');
  if (savedId) { driveFileId = savedId; return Promise.resolve({ id: driveFileId }); }
  return driveFetch('https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=name%3D%27' + DRIVE_FILE_NAME + '%27&fields=files(id,modifiedTime)')
  .then(function (res) { return res.json(); })
  .then(function (data) {
    if (data.files && data.files.length > 0) {
      driveFileId = data.files[0].id;
      localStorage.setItem('physioDriveFileId', driveFileId);
      return { id: driveFileId, modifiedTime: data.files[0].modifiedTime };
    }
    return null;
  });
}

function readDriveFile(fileId) {
  return driveFetch('https://www.googleapis.com/drive/v3/files/' + fileId + '?alt=media')
  .then(function (res) { return res.json(); });
}

function writeDriveFile(data) {
  var jsonStr = JSON.stringify(data);
  if (driveFileId) {
    return driveFetch('https://www.googleapis.com/upload/drive/v3/files/' + driveFileId + '?uploadType=media', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: jsonStr
    }).then(function (res) { return res.json(); });
  }
  var boundary = '---physio' + Date.now();
  var metadata = { name: DRIVE_FILE_NAME, mimeType: 'application/json', parents: ['appDataFolder'] };
  var body = '--' + boundary + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify(metadata) + '\r\n--' + boundary + '\r\nContent-Type: application/json\r\n\r\n' + jsonStr + '\r\n--' + boundary + '--';
  return driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
    method: 'POST', headers: { 'Content-Type': 'multipart/related; boundary=' + boundary }, body: body
  })
  .then(function (res) { return res.json(); })
  .then(function (file) {
    driveFileId = file.id;
    localStorage.setItem('physioDriveFileId', driveFileId);
    return file;
  });
}

// ══════════════════════════════════════════════════════════
//  MERGE LOGIC — PhysioTrainer-specific
//  Exercises & Workouts: ID-based merge, keep the version
//    with the most recent updatedAt (like Notes' items).
//  Sessions: append-only union by ID (never lose a recorded
//    workout session — they're historical records).
// ══════════════════════════════════════════════════════════

function getLocalData() {
  try { return JSON.parse(window.Storage.exportData()); }
  catch(e) { return null; }
}

function setLocalData(data) {
  window.Storage.importData(JSON.stringify(data));
  window.location.reload();
}

// Merge a single collection by ID + updatedAt
function mergeById(localArr, cloudArr) {
  var map = {};
  var i;
  // Cloud first (base)
  for (i = 0; i < cloudArr.length; i++) {
    var c = cloudArr[i];
    if (c.id) map[c.id] = c;
  }
  // Local overrides if newer
  for (i = 0; i < localArr.length; i++) {
    var l = localArr[i];
    if (!l.id) continue;
    var existing = map[l.id];
    if (!existing) {
      map[l.id] = l;
    } else {
      // Keep whichever has a more recent updatedAt
      var localTime = l.updatedAt || '';
      var cloudTime = existing.updatedAt || '';
      if (localTime >= cloudTime) {
        map[l.id] = l;
      }
    }
  }
  return Object.keys(map).map(function(k) { return map[k]; });
}

// Sessions are append-only: pure union by ID
function unionById(localArr, cloudArr) {
  var map = {};
  var i;
  for (i = 0; i < cloudArr.length; i++) {
    if (cloudArr[i].id) map[cloudArr[i].id] = cloudArr[i];
  }
  for (i = 0; i < localArr.length; i++) {
    if (localArr[i].id) map[localArr[i].id] = localArr[i];
  }
  return Object.keys(map).map(function(k) { return map[k]; });
}

function mergePhysioData(local, cloud) {
  if (!local) return cloud;
  if (!cloud) return local;

  return {
    exercises: mergeById(local.exercises || [], cloud.exercises || []),
    workouts: mergeById(local.workouts || [], cloud.workouts || []),
    sessions: unionById(local.sessions || [], cloud.sessions || [])
  };
}

function hasData(d) {
  return d && ((d.exercises && d.exercises.length > 0) || (d.workouts && d.workouts.length > 0) || (d.sessions && d.sessions.length > 0));
}

function getCountLabel(data) {
  if (!data) return '0 items';
  var total = (data.exercises ? data.exercises.length : 0) + (data.workouts ? data.workouts.length : 0) + (data.sessions ? data.sessions.length : 0);
  return total + ' elementi';
}

// ── First sync check ──
function firstSyncCheck() {
  ensureToken().then(findDriveFile).then(function (fileInfo) {
    var localData = getLocalData() || { exercises: [], workouts: [], sessions: [] };
    var localExists = hasData(localData);

    if (!fileInfo) {
      // No cloud file at all
      if (localExists) {
        // Local has data but no cloud file → show dialog (cloud = 0)
        pendingDriveData = { exercises: [], workouts: [], sessions: [] };
        if (syncLocalCount) syncLocalCount.textContent = getCountLabel(localData);
        if (syncCloudCount) syncCloudCount.textContent = '0 elementi';
        if (syncConflictOverlay) syncConflictOverlay.style.display = 'flex';
        return;
      }
      // Both empty → nothing to ask
      localStorage.setItem('physioLastSync', now());
      updateSyncStatus('Sincronizzato ✓', '');
      return;
    }
    return readDriveFile(fileInfo.id).then(function (driveData) {
      var cloudExists = hasData(driveData);

      if (!localExists && !cloudExists) {
        // Both empty → nothing to ask
        localStorage.setItem('physioLastSync', now());
        updateSyncStatus('Sincronizzato ✓', '');
        return;
      }

      // At least one side has data → always ask the user
      pendingDriveData = driveData;
      if (syncLocalCount) syncLocalCount.textContent = getCountLabel(localData);
      if (syncCloudCount) syncCloudCount.textContent = getCountLabel(driveData);
      if (syncConflictOverlay) syncConflictOverlay.style.display = 'flex';
    });
  }).catch(function (err) { console.error('First sync error:', err); });
}

// ── Startup sync (with merge) ──
function performStartupSync() {
  if (isSyncing || !googleUser) return;
  isSyncing = true;
  ensureToken().then(findDriveFile).then(function (fileInfo) {
    if (fileInfo) {
      return readDriveFile(fileInfo.id).then(function (driveData) {
        if (hasData(driveData)) {
          var localData = getLocalData();
          var merged = mergePhysioData(localData, driveData);
          // Import merged data into Storage
          window.Storage.importData(JSON.stringify(merged));
          // Re-render if the router is available
          if (typeof App !== 'undefined' && App.navigate) {
            App.navigate(window.location.hash || '#home');
          }
          return writeDriveFile(merged);
        }
        return writeDriveFile(getLocalData());
      });
    } else {
      return writeDriveFile(getLocalData());
    }
  }).then(function () {
    localStorage.setItem('physioLastSync', now());
    hasPendingChanges = false;
    updateSyncStatus('Sincronizzato ✓', '');
  }).catch(function(err) {
    console.error('Startup sync error:', err);
  }).finally(function () { isSyncing = false; });
}

// ── Manual / silent full sync (with merge) ──
function syncWithDrive(silent) {
  if (isSyncing || !googleUser) return;
  isSyncing = true;
  if (!silent) updateSyncStatus('Sincronizzazione...', 'syncing');
  ensureToken().then(findDriveFile).then(function (fileInfo) {
    if (fileInfo) {
      return readDriveFile(fileInfo.id).then(function (driveData) {
        if (hasData(driveData)) {
          var localData = getLocalData();
          var merged = mergePhysioData(localData, driveData);
          window.Storage.importData(JSON.stringify(merged));
          if (typeof App !== 'undefined' && App.navigate) {
            App.navigate(window.location.hash || '#home');
          }
          return writeDriveFile(merged);
        }
        return writeDriveFile(getLocalData());
      });
    } else {
      return writeDriveFile(getLocalData());
    }
  }).then(function () {
    localStorage.setItem('physioLastSync', now());
    hasPendingChanges = false;
    updateSyncStatus('Sincronizzato ✓', '');
    if (!silent) {
      updateSyncStatus('Ultima sync: adesso', '');
      setTimeout(function () { if (!isSyncing) updateSyncStatus('Sincronizzato ✓', ''); }, 3000);
    }
  }).catch(function(err) {
    console.error('Sync error:', err);
    if (!silent) updateSyncStatus('Errore di sync', 'error');
  }).finally(function () { isSyncing = false; });
}

// ── Fast sync (direct PATCH, ~150ms) ──
var fastSyncTimer = null;
var hasPendingChanges = false;
function scheduleFastSync() {
  if (!googleUser || !googleAccessToken || !driveFileId) return;
  clearTimeout(fastSyncTimer);
  fastSyncTimer = setTimeout(function() {
    if (isSyncing) return;
    isSyncing = true;
    hasPendingChanges = false;
    updateSyncStatus('Salvataggio...', 'syncing');
    writeDriveFile(getLocalData())
      .then(function() {
        localStorage.setItem('physioLastSync', now());
        if (!hasPendingChanges) updateSyncStatus('Sincronizzato ✓', '');
      })
      .catch(function(err) { updateSyncStatus('Errore di salvataggio', 'error'); })
      .finally(function() {
        isSyncing = false;
        if (hasPendingChanges) scheduleFastSync();
      });
  }, 500);
}

window.triggerAutoSync = function() {
  hasPendingChanges = true;
  if (googleUser && googleAccessToken) {
    if (driveFileId) scheduleFastSync();
    else syncWithDrive(true);
  }
};

document.addEventListener('visibilitychange', function () {
  if (document.visibilityState === 'hidden' && hasPendingChanges && googleUser && googleAccessToken && driveFileId && !isSyncing) {
    writeDriveFile(getLocalData()).catch(function(){});
    localStorage.setItem('physioLastSync', now());
    hasPendingChanges = false;
  }
});

setTimeout(function(){
  attachUIListeners();
  initGoogleAuth();
}, 500);
