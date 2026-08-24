'use strict';

(function () {
	const scriptEl = document.currentScript;
	const baseURL = scriptEl && scriptEl.src
		? scriptEl.src.substring(0, scriptEl.src.lastIndexOf('/') + 1)
		: '';

	function loadScript(src) {
		return new Promise((resolve, reject) => {
			const s = document.createElement('script');
			s.src = src;
			s.onload = resolve;
			s.onerror = reject;
			document.head.appendChild(s);
		});
	}

	/**
	 * Core library class for VGMPlay-JS.
	 * Can load and play VGM/VGZ files from URLs or ZIP archives.
	 */
	class VGMPlayLibrary {
		constructor() {
			this.functionsWrapped = false;
			this.isVGMLoaded = false;
			this.isVGMPlaying = false;
			this.isPlaybackPaused = true;
			this.generatingAudio = false;
			this.sampleRate = 44100;
			this.dataPtrs = [];
			this.zipCache = new Map();
			this.amountOfGamesLoaded = 0;
			this.games = [];
			this._initPromise = null;
			this._loadLock = Promise.resolve();
			this.context = null;
			this._userGesture = false;
			this._gestureInstalled = false;
			this._gestureHandler = null;
			this._buffersPumped = 0;
			this._installGestureUnlock();
		}

		_withLoadLock(fn) {
			this._loadLock = this._loadLock.then(fn, fn);
			return this._loadLock;
		}

		_installGestureUnlock() {
			if (this._gestureInstalled) return;
			this._gestureInstalled = true;
			this._gestureHandler = async () => {
				this._userGesture = true;
				if (this.context && this.context.state === 'suspended') {
					try { await this.context.resume(); } catch { }
				}
			};
			document.body.addEventListener('click', this._gestureHandler, { once: true });
			document.body.addEventListener('keydown', this._gestureHandler, { once: true });
		}

		/**
		 * Initializes the library, loads necessary scripts and WASM module.
		 * @returns {Promise<void>}
		 */
  async init(options = {}) {
    this._initOptions = options;
    if (!this._initPromise) {
      this._initPromise = this._doInit(options);
    } else if (options.audioContext && this.context !== options.audioContext) {
      this.stop();
      this.workletNode = null;
      this.context = null;
      this._initPromise = this._doInit(options);
    }
    return this._initPromise;
  }

  async _doInit(options = {}) {
			window.Module = window.Module || {};
			if (!window.Module.dataFileDownloads) window.Module.dataFileDownloads = {};
			if (!window.Module.expectedDataFileDownloads) window.Module.expectedDataFileDownloads = 0;
			window.Module.print = () => { };
			window.Module.printErr = () => { };
			const base = baseURL;
			window.Module.locateFile = function (path, prefix) {
				if (path.endsWith('.data')) return base + path;
				return prefix + path;
			};

			let modular = false;
			try {
				await loadScript(baseURL + 'vgmplay-js.js');
				if (typeof VGMPlay === 'function') {
					modular = true;
				}
			} catch (e) {
				console.warn("Failed to load vgmplay-js.js from " + baseURL, e);
				throw e;
			}

			await loadScript(baseURL + 'minizip-asm.min.js');

			if (modular) {
				window.Module = await VGMPlay(window.Module);
			} else {
				await new Promise(resolve => {
					const check = () => {
						if (typeof Module !== 'undefined' && Module.calledRun && typeof FS !== 'undefined') resolve();
						else setTimeout(check, 50);
					};
					check();
				});
			}

			this._wrapFunctions();
			await this._initAudio(options);
		}

		_wrapFunctions() {
			if (this.functionsWrapped) return;
			this.FillBuffer = Module.cwrap('FillBuffer2', 'void', ['number', 'number', 'number']);
			this.OpenVGMFile = Module.cwrap('OpenVGMFile', 'number', ['string']);
			this.CloseVGMFile = Module.cwrap('CloseVGMFile');
			this.PlayVGM = Module.cwrap('PlayVGM');
			this.StopVGM = Module.cwrap('StopVGM');
			this.VGMEnded = Module.cwrap('VGMEnded');
			this.SetSampleRate = Module.cwrap('SetSampleRate', 'number', ['number']);
			this.SetLoopCount = Module.cwrap('SetLoopCount', 'number', ['number']);
			this.SeekVGM = Module.cwrap('Seek', 'number', ['number', 'number']);

			this.dataPtrs[0] = Module._malloc(16384 * 2);
			this.dataPtrs[1] = Module._malloc(16384 * 2);

			this.functionsWrapped = true;
		}

  async _initAudio(options = {}) {
    const externalCtx = options.audioContext;
    this.context =
      externalCtx ||
      this.context ||
      new (window.AudioContext || window.webkitAudioContext)();
    this.sampleRate = this.context.sampleRate || 44100;
    this.SetSampleRate(this.sampleRate);

    // If user already interacted, try to resume immediately.
    if (this._userGesture && this.context.state === 'suspended') {
      try { await this.context.resume(); } catch { }
    }

    if (!this.workletNode || this.workletNode.context !== this.context) {
      await this.context.audioWorklet.addModule(baseURL + 'vgmplay-audio-processor.js');
      this.workletNode = new AudioWorkletNode(this.context, 'vgmplay-processor', {
        numberOfOutputs: 1,
        outputChannelCount: [2]
      });
      this.masterGain = this.context.createGain();
      // Slight gain boost for libvgm output in the minimal build.
      this.masterGain.gain.value = 2.0;
      this.workletNode.connect(this.masterGain);
    }

			this.workletNode.port.onmessage = (e) => {
				if (e.data && e.data.type === 'need-data') {
					this._pumpBuffers();
				}
			};
		}

		generateBuffer() {
			const N = 4096;
			this.FillBuffer(this.dataPtrs[0], this.dataPtrs[1], N);

			const leftHeap = new Float32Array(Module.HEAPU8.buffer, this.dataPtrs[0], N);
			const rightHeap = new Float32Array(Module.HEAPU8.buffer, this.dataPtrs[1], N);

			const left = new Float32Array(leftHeap);
			const right = new Float32Array(rightHeap);

			return { left, right };
		}

		_pumpBuffers() {
			if (!this.isVGMPlaying || this.isPlaybackPaused) return;
			if (this._buffersPumped > 2 && this.VGMEnded && this.VGMEnded()) return;

			for (let i = 0; i < 2; i++) {
				const buf = this.generateBuffer();
				this.workletNode.port.postMessage({
					type: 'buffer',
					left: buf.left,
					right: buf.right
				}, [buf.left.buffer, buf.right.buffer]);
			}
			this._buffersPumped++;
		}

  loadFromBuffer(data, filename) {
    const safeName = (filename || 'track.vgm').replace(/[^a-zA-Z0-9._-]/g, '_');
    const fsPath = '/tmp/' + safeName;
    this._loadFileToFS(fsPath, data);
    return fsPath;
  }

  async playFromBuffer(data, filename, loopCount = 1) {
    await this.init(this._initOptions || {});
    if (this.isVGMLoaded || this.isVGMPlaying) {
      this.stop();
    }
    const fsPath = this.loadFromBuffer(data, filename);
    if (!fsPath) return false;
    if (this.SetLoopCount) this.SetLoopCount(loopCount);
    const ok = this.load(fsPath);
    if (!ok) return false;
    this.play();
    return true;
  }

  hasEnded() {
    return !!(this.VGMEnded && this.VGMEnded());
  }

  async loadVGMFromURL(url) {
			await this.init();
			const response = await fetch(url);
			if (!response.ok) {
				console.error('Failed to fetch', url, response.status);
				return null;
			}
			const data = new Uint8Array(await response.arrayBuffer());
			const parts = url.split('/');
			const filename = parts[parts.length - 1].split('?')[0].split('#')[0] || 'remote.vgm';
			const fsPath = '/tmp/' + filename;
			this._loadFileToFS(fsPath, data);
			return fsPath;
		}

		async loadZip(url) {
			await this.init();
			if (this.zipCache.has(url)) return this.zipCache.get(url);

			const response = await fetch(url);
			if (!response.ok) {
				console.error('Failed to fetch', url, response.status);
				return null;
			}
			const buf = await response.arrayBuffer();
			const byteArray = new Uint8Array(buf);
			if (!byteArray || byteArray.byteLength === 0) {
				console.error('Empty zip buffer for', url);
				return null;
			}
			const mz = new Minizip(byteArray);
			const fileList = mz.list();
			const entries = Array.isArray(fileList)
				? fileList
				: (fileList && (fileList.files || fileList.filelist || fileList.entries))
					? (fileList.files || fileList.filelist || fileList.entries)
					: Object.values(fileList || {});
			const files = [];
			const gamePath = '/tmp/game' + this.amountOfGamesLoaded;
			this._makedirs(gamePath);

			for (const entry of entries) {
				if (!entry) continue;
				const relName = entry.filepath || entry.filename || entry.name;
				if (!relName) continue;
				if (entry.directory) continue;
				const lower = relName.toLowerCase();
				if (!lower.endsWith('.vgm') && !lower.endsWith('.vgz') && !lower.endsWith('.mp3') && !lower.endsWith('.flac') && !lower.endsWith('.ogg') && !lower.endsWith('.wav')) continue;

				const data = mz.extract(relName);
				const fsPath = gamePath + '/' + relName;
				const lastSlash = fsPath.lastIndexOf('/');
				if (lastSlash > gamePath.length) {
					const dir = fsPath.substring(0, lastSlash);
					this._makedirs(dir);
				}
				this._loadFileToFS(fsPath, data);
				files.push({ filepath: fsPath });
			}

			const game = { files };
			this.games.push(game);
			this.zipCache.set(url, game);
			this.amountOfGamesLoaded++;
			return game;
		}

		_loadFileToFS(path, data) {
			try {
				if (!FS.analyzePath('/tmp').exists) FS.mkdir('/tmp');
			} catch { }
			try {
				FS.unlink(path);
			} catch { }
			FS.createDataFile(
				path.substring(0, path.lastIndexOf('/')),
				path.substring(path.lastIndexOf('/') + 1),
				data,
				true,
				true
			);
		}

		_makedirs(path) {
			const parts = path.split('/');
			let current = '';
			for (const p of parts) {
				if (!p) continue;
				current += '/' + p;
				try {
					if (!FS.analyzePath(current).exists) {
						FS.mkdir(current);
					}
				} catch { }
			}
		}

		load(fileName) {
			if (this.isVGMLoaded && this.StopVGM) this.StopVGM();
			if (this.CloseVGMFile) this.CloseVGMFile();
			const res = this.OpenVGMFile(fileName);
			this.isVGMLoaded = !!res;
			return this.isVGMLoaded;
		}

		play() {
			this.isPlaybackPaused = false;
			if (!this.isVGMPlaying) {
				this.PlayVGM();
				this.isVGMPlaying = true;
				this._buffersPumped = 0;
			}
			if (this.context.state === 'suspended') {
				this.context.resume();
			}
			this.workletNode.port.postMessage({ type: 'start' });
			if (!this.generatingAudio) {
				this._pumpBuffers();
				this.generatingAudio = true;
			}
		}

  pause() {
    this.isPlaybackPaused = true;
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'pause' });
    }
  }

  stop() {
    this.isVGMPlaying = false;
    this.isPlaybackPaused = true;
    if (this.workletNode) {
      this.workletNode.port.postMessage({ type: 'stop' });
    }
			if (this.StopVGM) this.StopVGM();
			if (this.CloseVGMFile) this.CloseVGMFile();
			this.isVGMLoaded = false;
		}

		async playTrack(url, loopCount = 0) {
			await this.init();
			if (this.isVGMLoaded || this.isVGMPlaying) {
				this.stop();
			}
			const isZip = /\.zip$/i.test(url.split('?')[0].split('#')[0]);
			if (isZip) return this.playZipTrack(url, 0, loopCount);
			const fsPath = await this.loadVGMFromURL(url);
			if (!fsPath) return;
			if (this.SetLoopCount) this.SetLoopCount(loopCount);
			const ok = this.load(fsPath);
			if (!ok) return;
			this.play();
		}

		async playZipTrack(zipUrl, trackIndex = 0, loopCount = 0) {
			await this.init();
			if (this.isVGMLoaded || this.isVGMPlaying) {
				this.stop();
			}
			const game = await this.loadZip(zipUrl);
			if (!game || !game.files || !game.files.length) return;
			const file = game.files[trackIndex] || game.files[0];
			if (this.SetLoopCount) this.SetLoopCount(loopCount);
			const ok = this.load(file.filepath);
			if (!ok) return;
			this.play();
		}
	}

	const instance = new VGMPlayLibrary();
	window.vgmPlayInstance = instance;
})();
