import axios from 'axios'
import Worker from './Worker.js'

export default class Utils {
  constructor () {
  }

  static getUserMedia (container, markerUrl, video, canvas, root, statsObj, configData) {
    const facing = configData.videoSettings.facingMode || 'environment'

    const onError = configData.onError || function (err) { console.error('ARnft internal getUserMedia', err) }

    let readyToPlay = false
    const eventNames = [
      'touchstart', 'touchend', 'touchmove', 'touchcancel',
      'click', 'mousedown', 'mouseup', 'mousemove',
      'keydown', 'keyup', 'keypress', 'scroll'
    ]
    const play = () => {
      if (readyToPlay) {
        video.play().then(() => {
          this._startWorker(
            container,
            markerUrl,
            video,
            video.videoWidth,
            video.videoHeight,
            canvas,
            () => {
              if (statsObj.stats) {
                statsObj.statsMain.update()
              }
            },
            () => {
              if (statsObj.stats) {
                statsObj.statsWorker.update()
              }
            },
            root,
            configData
          )
        }).catch((error) => {
          onError(error)
          // ARnft._teardownVideo(video) // to be solved !!
        })
        if (!video.paused) {
          eventNames.forEach((eventName) => {
            window.removeEventListener(eventName, play, true)
          })
        }
      }
    }
    eventNames.forEach((eventName) => {
      window.addEventListener(eventName, play, true)
    })

    const success = (stream) => {
      // DEPRECATED: don't use window.URL.createObjectURL(stream) any longer it might be removed soon. Only there to support old browsers src: https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL
      if (window.URL.createObjectURL) {
        // Need to add try-catch because iOS 11 fails to createObjectURL from stream. As this is deprecated  we should remove this soon
        try {
          video.srcObject = stream // DEPRECATED: this feature is in the process to being deprecated
        } catch (ex) {
          // Nothing todo, the purpose of this is to remove an error from the console on iOS 11
        }
      }
      video.srcObject = stream // This should be used instead. Which has the benefit to give us access to the stream object
      readyToPlay = true
      video.autoplay = true
      video.playsInline = true
      play() // Try playing without user input, should work on non-Android Chrome
    }

    const constraints = {}
    const mediaDevicesConstraints = {}
    if (configData.videoSettings.width) {
      mediaDevicesConstraints.width = configData.videoSettings.width
      if (typeof configData.videoSettings.width === 'object') {
        if (configData.videoSettings.width.max) {
          constraints.maxWidth = configData.videoSettings.width.max
        }
        if (configData.videoSettings.width.min) {
          constraints.minWidth = configData.videoSettings.width.min
        }
      } else {
        constraints.maxWidth = configData.videoSettings.width
      }
    }

    if (configData.videoSettings.height) {
      mediaDevicesConstraints.height = configData.videoSettings.height
      if (typeof configData.videoSettings.height === 'object') {
        if (configData.videoSettings.height.max) {
          constraints.maxHeight = configData.videoSettings.height.max
        }
        if (configData.videoSettings.height.min) {
          constraints.minHeight = configData.videoSettings.height.min
        }
      } else {
        constraints.maxHeight = configData.videoSettings.height
      }
    }

    mediaDevicesConstraints.facingMode = facing
    mediaDevicesConstraints.deviceId = configData.videoSettings.deviceId

    navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia || navigator.msGetUserMedia
    const hdConstraints = {
      audio: false,
      video: constraints
    }

    if (navigator.mediaDevices || window.MediaStreamTrack.getSources) {
      if (navigator.mediaDevices) {
        navigator.mediaDevices.getUserMedia({
          audio: false,
          video: mediaDevicesConstraints
        }).then(success, onError)
      } else {
        // This function of accessing the media device is deprecated and outdated and shouldn't be used anymore.
        window.MediaStreamTrack.getSources((sources) => {
          let facingDir = mediaDevicesConstraints.facingMode
          if (facing && facing.exact) {
            facingDir = facing.exact
          }
          for (let i = 0; i < sources.length; i++) {
            if (sources[i].kind === 'video' && sources[i].facing === facingDir) {
              hdConstraints.video.mandatory.sourceId = sources[i].id
              break
            }
          }
          if (facing && facing.exact && !hdConstraints.video.mandatory.sourceId) {
            onError('Failed to get camera facing the wanted direction')
          } else {
            if (navigator.getUserMedia) {
              navigator.getUserMedia(hdConstraints, success, onError)
            } else {
              onError('navigator.getUserMedia is not supported on your browser')
            }
          }
        })
      }
    } else {
      if (navigator.getUserMedia) {
        navigator.getUserMedia(hdConstraints, success, onError)
      } else {
        onError('navigator.getUserMedia is not supported on your browser')
      }
    }
  }

  static _startWorker (container, markerUrl, video, input_width, input_height, canvas_draw, render_update, track_update, root, configData) {
    let vw, vh
    let sw, sh
    let pscale, sscale
    let w, h
    let pw, ph
    let ox, oy
    let worker

    const canvas_process = document.createElement('canvas')
    const context_process = canvas_process.getContext('2d')

    const renderer = new THREE.WebGLRenderer({
      canvas: canvas_draw,
      alpha: configData.renderer.alpha,
      antialias: configData.renderer.antialias,
      precision: configData.renderer.precision
    })
    renderer.setPixelRatio(window.devicePixelRatio)

    const scene = new THREE.Scene()

    const camera = new THREE.Camera()
    camera.matrixAutoUpdate = false

    scene.add(camera)

    const light = new THREE.AmbientLight(0xffffff)
    scene.add(light)

    scene.add(root)

    const load = () => {
      vw = input_width
      vh = input_height

      pscale = 320 / Math.max(vw, (vh / 3) * 4)
      sscale = this.isMobile() ? window.outerWidth / input_width : 1

      sw = vw * sscale
      sh = vh * sscale

      w = vw * pscale
      h = vh * pscale
      pw = Math.max(w, (h / 3) * 4)
      ph = Math.max(h, (w / 4) * 3)
      ox = (pw - w) / 2
      oy = (ph - h) / 2
      canvas_process.style.clientWidth = pw + 'px'
      canvas_process.style.clientHeight = ph + 'px'
      canvas_process.width = pw
      canvas_process.height = ph

      renderer.setSize(sw, sh)

      worker = new Worker()

      worker.postMessage({
        type: 'load',
        pw: pw,
        ph: ph,
        camera_para: configData.cameraPara,
        marker: markerUrl,
        artoolkitUrl: configData.artoolkitUrl,
        addPath: configData.addPath
      })

      worker.onmessage = (ev) => {
        const msg = ev.data
        switch (msg.type) {
          case 'loaded': {
            const proj = JSON.parse(msg.proj)
            const ratioW = pw / w
            const ratioH = ph / h
            proj[0] *= ratioW
            proj[4] *= ratioW
            proj[8] *= ratioW
            proj[12] *= ratioW
            proj[1] *= ratioH
            proj[5] *= ratioH
            proj[9] *= ratioH
            proj[13] *= ratioH
            this.setMatrix(camera.projectionMatrix, proj)
            break
          }
          case 'endLoading': {
            if (msg.end == true) {
              // removing loader page if present
              const loader = document.getElementById('loading')
              if (loader) {
                loader.querySelector('.loading-text').innerText = 'Start the tracking!'
                setTimeout(function () {
                  loader.parentElement.removeChild(loader)
                }, 2000)
              }
            }
            break
          }
          case 'nftData': {
            let nft = JSON.parse(msg.nft)
            var nftEvent = new CustomEvent('getNFTData', {detail: {dpi: nft.dpi, width: nft.width, height: nft.height}})
            document.dispatchEvent(nftEvent)
            break
          }
          case 'found': {
            found(msg)
            break
          }
          case 'not found': {
            found(null)
            break
          }
        }
        track_update()
        process()
      }
    }

    let world

    const found = (msg) => {
      if (!msg) {
        world = null
      } else {
        world = JSON.parse(msg.matrixGL_RH)
      }
    }

    let lasttime = Date.now()
    let time = 0

    const process = () => {
      context_process.fillStyle = 'black'
      context_process.fillRect(0, 0, pw, ph)
      context_process.drawImage(video, 0, 0, vw, vh, ox, oy, w, h)

      const imageData = context_process.getImageData(0, 0, pw, ph)
      worker.postMessage({ type: 'process', imagedata: imageData }, [
        imageData.data.buffer
      ])
    }

    const tick = () => {
      draw()
      requestAnimationFrame(tick)
    }

    const draw = () => {
      render_update()
      const now = Date.now()
      const dt = now - lasttime
      time += dt
      lasttime = now

      const interpolationFactor = 24

      const trackedMatrix = {
        // for interpolation
        delta: [
          0, 0, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0
        ],
        interpolated: [
          0, 0, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0,
          0, 0, 0, 0
        ]
      }

      if (!world) {
        root.visible = false
      } else {
        root.visible = true

        // interpolate matrix
        for (let i = 0; i < 16; i++) {
          trackedMatrix.delta[i] = world[i] - trackedMatrix.interpolated[i]
          trackedMatrix.interpolated[i] =
                    trackedMatrix.interpolated[i] +
                    trackedMatrix.delta[i] / interpolationFactor
        }
        // set matrix of 'root' by detected 'world' matrix
        this.setMatrix(root.matrix, trackedMatrix.interpolated)
      }

      renderer.render(scene, camera)
    }

    load()
    tick()
    process()
  }

  static isMobile () {
    return /Android|mobile|iPad|iPhone/i.test(navigator.userAgent)
  }

  static setMatrix (matrix, value) {
    const array = []
    for (const key in value) {
      array[key] = value[key]
    }
    if (typeof matrix.elements.set === 'function') {
      matrix.elements.set(array)
    } else {
      matrix.elements = [].slice.call(array)
    }
  };

  static async jsonParser (requestURL) {
    const response = await axios.get(requestURL, { responseType: 'json' })
      .then((res) => { return res.data })
      .catch((error) => { console.error(error) })
    return response
  }
}
