document.getElementById('policy-presets').addEventListener('change', function() {
    const selectedPolicy = this.value;
    loadPolicy(selectedPolicy);
});

function loadPolicy(policyName) {
    // Load the selected policy settings
    const policy = getCurrentPolicy();
    document.getElementById('fetch').checked = policy.network.fetch;
    document.getElementById('xhr').checked = policy.network.xhr;
    document.getElementById('websocket').checked = policy.network.websocket;
    document.getElementById('beacon').checked = policy.network.beacon;
    document.getElementById('geolocation').checked = policy.geolocation;
    document.getElementById('camera').checked = policy.camera;
    document.getElementById('microphone').checked = policy.microphone;
    document.getElementById('clipboard').checked = policy.clipboard;
    document.getElementById('notifications').checked = policy.notifications;
    document.getElementById('webrtc').checked = policy.webrtc;
    document.getElementById('inline').checked = policy.scriptLoading.inline;
    document.getElementById('external').checked = policy.scriptLoading.external;
}

function savePolicy() {
    // Save the current policy settings
    const newPolicy = {
        network: {
            fetch: document.getElementById('fetch').checked,
            xhr: document.getElementById('xhr').checked,
            websocket: document.getElementById('websocket').checked,
            beacon: document.getElementById('beacon').checked
        },
        geolocation: document.getElementById('geolocation').checked,
        camera: document.getElementById('camera').checked,
        microphone: document.getElementById('microphone').checked,
        clipboard: document.getElementById('clipboard').checked,
        notifications: document.getElementById('notifications').checked,
        webrtc: document.getElementById('webrtc').checked,
        scriptLoading: {
            inline: document.getElementById('inline').checked,
            external: document.getElementById('external').checked
        }
    };
    updatePolicy('custom', newPolicy);
}