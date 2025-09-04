/**
 * 初始化应用入口
 * @returns {void}
 */
(function main() {
  /** @type {HTMLInputElement} */
  const fileInput = document.getElementById('fileInput');
  /** @type {HTMLAudioElement} */
  const audioEl = document.getElementById('audioEl');
  /** @type {HTMLButtonElement} */
  const playBtn = document.getElementById('playBtn');
  /** @type {HTMLButtonElement} */
  const pauseBtn = document.getElementById('pauseBtn');
  /** @type {HTMLButtonElement} */
  const stopBtn = document.getElementById('stopBtn');
  /** @type {HTMLCanvasElement} */
  const vizCanvas = document.getElementById('viz');
  /** @type {HTMLSelectElement} */
  const fftSizeSelect = document.getElementById('fftSize');
  /** @type {HTMLInputElement} */
  const smoothingInput = document.getElementById('smoothing');
  /** @type {HTMLInputElement} */
  const binsInput = document.getElementById('bins');
  /** @type {HTMLInputElement} */
  const sendFpsInput = document.getElementById('sendFps');
  /** @type {HTMLButtonElement} */
  const testToneBtn = document.getElementById('testToneBtn');
  /** @type {HTMLButtonElement} */
  const sendTestBtn = document.getElementById('sendTestBtn');
  /** @type {HTMLInputElement} */
  const wsUrlInput = document.getElementById('wsUrl');
  /** @type {HTMLButtonElement} */
  const connectBtn = document.getElementById('connectBtn');
  /** @type {HTMLButtonElement} */
  const disconnectBtn = document.getElementById('disconnectBtn');
  /** @type {HTMLSpanElement} */
  const connStatus = document.getElementById('connStatus');

  /** @type {AudioContext | null} */
  let audioCtx = null;
  /** @type {MediaElementAudioSourceNode | null} */
  let sourceNode = null;
  /** @type {AnalyserNode | null} */
  let analyser = null;
  /** @type {Uint8Array | null} */
  let freqData = null;
  /** @type {number} */
  let rafId = 0;
  /** @type {CanvasRenderingContext2D} */
  const ctx2d = vizCanvas.getContext('2d');
  /** @type {OscillatorNode | null} */
  let osc = null;
  /** @type {GainNode | null} */
  let gain = null;

  /** @type {WebSocket | null} */
  let socket = null;
  /** @type {number} */
  let sendTimer = 0;
  /** @type {number} */
  let heartbeatTimer = 0;

  // =============== 音频与分析 ===============

  fileInput.addEventListener('change', () => {
    const file = fileInput.files && fileInput.files[0];
    if (!file) return;
    const url = URL.createObjectURL(file);
    audioEl.src = url;
    enablePlaybackButtons(true);
  });

  playBtn.addEventListener('click', async () => {
    await ensureAudioGraph();
    await resumeAudioIfNeeded();
    await audioEl.play();
    startRender();
  });

  pauseBtn.addEventListener('click', () => {
    audioEl.pause();
  });

  stopBtn.addEventListener('click', () => {
    audioEl.pause();
    audioEl.currentTime = 0;
  });

  // 兼容用户使用 <audio> 原生控件播放/暂停
  audioEl.addEventListener('play', async () => {
    await ensureAudioGraph();
    await resumeAudioIfNeeded();
    startRender();
  });
  audioEl.addEventListener('pause', () => {
    // 不停止渲染循环，保持画面，但也可以选择停止
  });

  fftSizeSelect.addEventListener('change', () => {
    if (analyser) analyser.fftSize = Number(fftSizeSelect.value);
    resizeFreqBuffer();
  });

  smoothingInput.addEventListener('change', () => {
    if (analyser) analyser.smoothingTimeConstant = clamp(Number(smoothingInput.value), 0, 1);
  });

  // 测试：开启/关闭合成器正弦波
  testToneBtn.addEventListener('click', async () => {
    await ensureAudioGraph();
    if (!osc) {
      gain = audioCtx.createGain();
      gain.gain.value = 0.2;
      osc = audioCtx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = 220; // A3
      osc.connect(gain);
      gain.connect(analyser);
      osc.start();
      testToneBtn.textContent = '关闭测试音';
    } else {
      try { osc.stop(); } catch {}
      osc.disconnect();
      gain && gain.disconnect();
      osc = null; gain = null;
      testToneBtn.textContent = '开启测试音';
    }
  });

  // 测试：直接发送一条固定的 audioFrame
  sendTestBtn.addEventListener('click', () => {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const payload = {
      type: 'audioFrame',
      time: performance.now(),
      features: { energy: 0.5, low: 0.8, mid: 0.4, high: 0.2, peak: 1.0 },
      spectrum: Array.from({ length: clamp(Math.floor(Number(binsInput.value)), 8, 256) }, (_, i) => Number((i / 64).toFixed(3)))
    };
    try { socket.send(JSON.stringify(payload)); } catch {}
  });

  // =============== WebSocket ===============

  connectBtn.addEventListener('click', () => {
    openSocket(wsUrlInput.value);
  });

  disconnectBtn.addEventListener('click', () => {
    closeSocket();
  });

  /**
   * 确保音频图谱构建
   * @returns {Promise<void>}
   */
  async function ensureAudioGraph() {
    if (!audioCtx) {
      audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      sourceNode = audioCtx.createMediaElementSource(audioEl);
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = Number(fftSizeSelect.value);
      analyser.smoothingTimeConstant = clamp(Number(smoothingInput.value), 0, 1);
      sourceNode.connect(analyser);
      analyser.connect(audioCtx.destination);
      resizeFreqBuffer();
    }
  }

  /**
   * 如 AudioContext 被挂起，则恢复（有些浏览器策略需要手势触发后 resume）
   */
  async function resumeAudioIfNeeded() {
    if (audioCtx && audioCtx.state === 'suspended') {
      try { await audioCtx.resume(); } catch (e) {}
    }
  }

  /** 调整频谱缓冲区大小 */
  function resizeFreqBuffer() {
    if (!analyser) return;
    freqData = new Uint8Array(analyser.frequencyBinCount);
  }

  /** 开始渲染循环 */
  function startRender() {
    cancelAnimationFrame(rafId);
    const render = () => {
      rafId = requestAnimationFrame(render);
      drawSpectrum();
    };
    render();
  }

  /** 频谱绘制与特征计算并尝试发送 */
  function drawSpectrum() {
    if (!analyser || !freqData) return;
    analyser.getByteFrequencyData(freqData);

    const width = vizCanvas.width;
    const height = vizCanvas.height;
    ctx2d.clearRect(0, 0, width, height);

    const bins = clamp(Math.floor(Number(binsInput.value)), 8, 256);
    const downsampled = downsample(freqData, bins);

    // 绘制柱状图
    const barW = width / bins;
    for (let i = 0; i < bins; i++) {
      const v = downsampled[i] / 255; // 0..1
      const h = v * height;
      ctx2d.fillStyle = `hsl(${Math.floor(200 + 100 * v)}, 80%, ${Math.floor(40 + 30 * v)}%)`;
      ctx2d.fillRect(i * barW, height - h, barW - 1, h);
    }

    // 计算能量特征
    const features = calcFeatures(downsampled);
    drawOverlay(features);

    // 发送到 TD（限速）
    maybeSend(features, downsampled);
  }

  /**
   * 计算特征：总体能量、低中高频能量与峰值
   * @param {Uint8Array} arr
   */
  function calcFeatures(arr) {
    const n = arr.length;
    let sum = 0;
    for (let i = 0; i < n; i++) sum += arr[i];
    const energy = sum / (n * 255);

    const low = avg(arr, 0, Math.floor(n * 0.15)) / 255;
    const mid = avg(arr, Math.floor(n * 0.15), Math.floor(n * 0.6)) / 255;
    const high = avg(arr, Math.floor(n * 0.6), n) / 255;
    const peak = Math.max(...arr) / 255;
    return { energy, low, mid, high, peak };
  }

  /** 在画布上绘制特征覆盖层 */
  function drawOverlay(f) {
    const w = vizCanvas.width;
    const h = vizCanvas.height;
    ctx2d.fillStyle = 'rgba(255,255,255,0.08)';
    ctx2d.fillRect(0, 0, 180, 70);
    ctx2d.fillStyle = '#e6edf3';
    ctx2d.font = '12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto';
    ctx2d.fillText(`E:${f.energy.toFixed(2)} L:${f.low.toFixed(2)} M:${f.mid.toFixed(2)} H:${f.high.toFixed(2)} P:${f.peak.toFixed(2)}`, 8, 20);
  }

  /**
   * 限速发送数据到 TD
   * @param {{energy:number,low:number,mid:number,high:number,peak:number}} features
   * @param {Uint8Array} spectrum
   */
  function maybeSend(features, spectrum) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    const fps = clamp(Number(sendFpsInput.value) || 30, 5, 120);
    const now = performance.now();
    const interval = 1000 / fps;
    if (!sendTimer || now - sendTimer >= interval) {
      sendTimer = now;
      /**
       * 发送格式（JSON）：
       * type: 'audioFrame'
       * time: performance timestamp
       * features: { energy, low, mid, high, peak }
       * spectrum: Float32[] 0..1 (降采样后的谱)
       */
      const payload = {
        type: 'audioFrame',
        time: now,
        features,
        spectrum: Array.from(spectrum, v => Number((v / 255).toFixed(4)))
      };
      try {
        socket.send(JSON.stringify(payload));
      } catch (e) {
        console.warn('WS send error', e);
      }
    }
  }

  // =============== 工具函数 ===============

  /**
   * 打开 WebSocket 连接
   * @param {string} url
   */
  function openSocket(url) {
    closeSocket();
    try {
      socket = new WebSocket(url);
    } catch (e) {
      setConnStatus('disconnected');
      return;
    }
    socket.addEventListener('open', () => {
      setConnStatus('connected');
      // 连接即发送 hello（调试用）
      try {
        socket && socket.send(JSON.stringify({ type: 'hello', from: 'web', time: performance.now() }));
      } catch {}
      // 每 5 秒发送 ping，便于链路确认
      clearInterval(heartbeatTimer);
      heartbeatTimer = setInterval(() => {
        try {
          socket && socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify({ type: 'ping', time: performance.now() }));
        } catch {}
      }, 5000);
    });
    socket.addEventListener('close', () => {
      setConnStatus('disconnected');
      clearInterval(heartbeatTimer);
    });
    socket.addEventListener('error', () => {
      setConnStatus('disconnected');
      clearInterval(heartbeatTimer);
    });
  }

  /** 关闭 WebSocket */
  function closeSocket() {
    if (socket && socket.readyState === WebSocket.OPEN) socket.close();
    socket = null;
    setConnStatus('disconnected');
    clearInterval(heartbeatTimer);
  }

  /**
   * 设置连接状态
   * @param {'connected'|'disconnected'} state
   */
  function setConnStatus(state) {
    connStatus.textContent = state === 'connected' ? '已连接' : '未连接';
    connStatus.classList.toggle('status-connected', state === 'connected');
    connStatus.classList.toggle('status-disconnected', state !== 'connected');
    disconnectBtn.disabled = state !== 'connected';
  }

  /**
   * 启用/禁用播放按钮
   * @param {boolean} enabled
   */
  function enablePlaybackButtons(enabled) {
    playBtn.disabled = !enabled;
    pauseBtn.disabled = !enabled;
    stopBtn.disabled = !enabled;
  }

  /**
   * 下采样到 bins 个点
   * @param {Uint8Array} data
   * @param {number} bins
   * @returns {Uint8Array}
   */
  function downsample(data, bins) {
    const out = new Uint8Array(bins);
    const bucketSize = data.length / bins;
    for (let i = 0; i < bins; i++) {
      const start = Math.floor(i * bucketSize);
      const end = Math.floor((i + 1) * bucketSize);
      out[i] = Math.floor(avg(data, start, end));
    }
    return out;
  }

  /**
   * 区间平均值
   * @param {Uint8Array} arr
   * @param {number} start
   * @param {number} end
   */
  function avg(arr, start, end) {
    const s = Math.max(0, Math.min(arr.length, start|0));
    const e = Math.max(s + 1, Math.min(arr.length, end|0));
    let sum = 0;
    for (let i = s; i < e; i++) sum += arr[i];
    return sum / (e - s);
  }

  /**
   * 数值裁剪
   * @param {number} v
   * @param {number} min
   * @param {number} max
   */
  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
})();


