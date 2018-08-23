var path = require('path')
// the menubar instance itself is an EventEmitter
var events = require('events')
var fs = require('fs')

var electron = require('electron')
var app = electron.app
// Tray is used for showing the icon which is the entry point of the app
var Tray = electron.Tray
// when clicking on the tray or being invoked through global shortcut, show a browser window.
var BrowserWindow = electron.BrowserWindow

var extend = require('extend')
// this is initialized with the window object that contains height/width information of the window, then when .calculate method is called, it calculates the window position based on the position of the tray, and the position option being passed in such as center, trayCenter, etc.
var Positioner = require('electron-positioner')

module.exports = function create (opts) {
  // if no opts defined, just pad the opts object using dir
  if (typeof opts === 'undefined') opts = {dir: app.getAppPath()}
  // if opts is a string, assume its the dir
  if (typeof opts === 'string') opts = {dir: opts}
  // if opts is an object but doesn't contain the dir, set it using app.getAppPath()
  // which returns the path of the current electron app.
  if (!opts.dir) opts.dir = app.getAppPath()
  // expect the dir to be absolute path.
  if (!(path.isAbsolute(opts.dir))) opts.dir = path.resolve(opts.dir)
  // if no absolute index file path is passed in, use the default index.html path.
  if (!opts.index) opts.index = 'file://' + path.join(opts.dir, 'index.html')
  // if no windowPosition is specified(from a list of supported position in electron-positioner)
  if (!opts.windowPosition) opts.windowPosition = (process.platform === 'win32') ? 'trayBottomCenter' : 'trayCenter'
  // do not show dock icon by default
  if (typeof opts.showDockIcon === 'undefined') opts.showDockIcon = false

  // ** questions: {
  //   1. when does 'before window is created' could happen?
  //   2. where would width/height is used?
  // }
  // set width/height on opts to be usable before the window is created
  opts.width = opts.width || 400
  opts.height = opts.height || 400
  opts.tooltip = opts.tooltip || ''

  // initialize the menubar as an event emitter.
  var menubar = new events.EventEmitter()
  // attach the main process as attribute of the menubar instance.
  menubar.app = app

  // ** is this only to handle when menubar is initlized multiple times?
  // ** for the use case of pretzel it seems that only attaching the event handler here is enough?
  if (app.isReady()) appReady()
  else app.on('ready', appReady)

  // Set / get options
  menubar.setOption = function (opt, val) {
    opts[opt] = val
  }

  menubar.getOption = function (opt) {
    return opts[opt]
  }

  return menubar


  function appReady () {
    // if it's macos that can show dock icon, and the showDockIcon is not enabled, then
    // hide the dock
    if (app.dock && !opts.showDockIcon) app.dock.hide()
    // checks the icon path, if not specified then use the default icon tempalte
    var iconPath = opts.icon || path.join(opts.dir, 'IconTemplate.png')
    // if specified icon doesn't exist, then again use the default icon.
    if (!fs.existsSync(iconPath)) {
      iconPath = path.join(__dirname, 'example', 'IconTemplate.png') // default cat icon
    }

    // the double click doesn't seem to work for macos, maybe it's a thing
    // on windows.
    var cachedBounds // cachedBounds are needed for double-clicked event
    // if specified that should invoke from right click
    var defaultClickEvent = opts.showOnRightClick ? 'right-click' : 'click'

    // looks like you can pass tray as an instance from the params?
    menubar.tray = opts.tray || new Tray(iconPath)
    // attach left/right click handler, always attach double click handler
    menubar.tray.on(defaultClickEvent, clicked)
    menubar.tray.on('double-click', clicked)
    // set the tooltip
    menubar.tray.setToolTip(opts.tooltip)

    var supportsTrayHighlightState = false
    // I don't really know what this try catch block is for, nor there is any explaination
    // from the original PR that added this block.
    // I'm guessing this is a way of testing whether or not current OS is mac or windows.
    try {
      menubar.tray.setHighlightMode('never')
      supportsTrayHighlightState = true
    } catch (e) {}

    // why this(to load the window when app is ready) is needed ?
    if (opts.preloadWindow) {
      createWindow()
    }

    menubar.showWindow = showWindow
    menubar.hideWindow = hideWindow
    menubar.emit('ready')

    function clicked (e, bounds) {
      if (e.altKey || e.shiftKey || e.ctrlKey || e.metaKey) return hideWindow()
      if (menubar.window && menubar.window.isVisible()) return hideWindow()
      cachedBounds = bounds || cachedBounds
      showWindow(cachedBounds)
    }

    function createWindow () {
      menubar.emit('create-window')
      var defaults = {
        show: false,
        frame: false
      }

      var winOpts = extend(defaults, opts)
      menubar.window = new BrowserWindow(winOpts)

      menubar.positioner = new Positioner(menubar.window)

      menubar.window.on('blur', function () {
        opts.alwaysOnTop ? emitBlur() : hideWindow()
      })

      if (opts.showOnAllWorkspaces !== false) {
        menubar.window.setVisibleOnAllWorkspaces(true)
      }

      menubar.window.on('close', windowClear)
      menubar.window.loadURL(opts.index)
      menubar.emit('after-create-window')
    }

    function showWindow (trayPos) {
      if (supportsTrayHighlightState) menubar.tray.setHighlightMode('always')
      if (!menubar.window) {
        createWindow()
      }

      menubar.emit('show')

      if (trayPos && trayPos.x !== 0) {
        // Cache the bounds
        cachedBounds = trayPos
      } else if (cachedBounds) {
        // Cached value will be used if showWindow is called without bounds data
        trayPos = cachedBounds
      } else if (menubar.tray.getBounds) {
        // Get the current tray bounds
        trayPos = menubar.tray.getBounds()
      }

      // Default the window to the right if `trayPos` bounds are undefined or null.
      var noBoundsPosition = null
      if ((trayPos === undefined || trayPos.x === 0) && opts.windowPosition.substr(0, 4) === 'tray') {
        noBoundsPosition = (process.platform === 'win32') ? 'bottomRight' : 'topRight'
      }

      // positioner.calculate(position, trayBounds)
      var position = menubar.positioner.calculate(noBoundsPosition || opts.windowPosition, trayPos)

      var x = (opts.x !== undefined) ? opts.x : position.x
      var y = (opts.y !== undefined) ? opts.y : position.y

      menubar.window.setPosition(x, y)
      menubar.window.show()
      menubar.emit('after-show')
      return
    }

    function hideWindow () {
      if (supportsTrayHighlightState) menubar.tray.setHighlightMode('never')
      if (!menubar.window) return
      menubar.emit('hide')
      menubar.window.hide()
      menubar.emit('after-hide')
    }

    function windowClear () {
      delete menubar.window
      menubar.emit('after-close')
    }

    function emitBlur () {
      menubar.emit('focus-lost')
    }
  }
}
