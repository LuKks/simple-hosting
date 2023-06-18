const tls = require('tls')
const http = require('http')
const https = require('https')
const fs = require('fs')
const httpProxy = require('http-proxy')
const reduceUA = require('reduce-user-agent')
const graceful = require('graceful-http')

class Hosting {
  constructor (opts = {}) {
    this.apps = new Map()

    this.log = !!opts.log
    this.behindProxy = opts.behindProxy

    this.proxy = httpProxy.createProxyServer()
    this.insecureServer = http.createServer()
    this.secureServer = https.createServer({ SNICallback: this._SNICallback.bind(this) })

    this.insecureServerClose = graceful(this.insecureServer)
    this.secureServerClose = graceful(this.secureServer)

    this.insecureServer.on('request', this._onrequest.bind(this, this.insecureServer))
    this.secureServer.on('request', this._onrequest.bind(this, this.secureServer))
  }

  add (servername, opts = {}) {
    if (this.apps.has(servername)) throw new Error('App already exists')
    if (!opts.destination) throw new Error('Destination is required')

    this.apps.set(servername, {
      secureContext: opts.cert && opts.key ? createSecureContext(opts.cert, opts.key) : null,
      destination: opts.destination
    })
  }

  edit (servername, opts = {}) {
    if (!this.apps.has(servername)) throw new Error('App does not exist')

    const app = this.apps.get(servername)

    if (opts.cert && opts.key) app.secureContext = createSecureContext(opts.cert, opts.key)
    if (opts.destination) app.destination = opts.destination
  }

  listen () {
    this.insecureServer.listen(80)
    this.secureServer.listen(443)
  }

  async close () {
    await Promise.all([
      this.insecureServerClose(),
      this.secureServerClose()
    ])
    this.proxy.close()
  }

  _SNICallback (servername, cb) {
    const app = this.apps.get(servername)

    if (this.log) console.log('SNI:', servername, 'App found?', !!app)

    if (app && app.secureContext) {
      cb(null, app.secureContext)
      return
    }

    cb()
  }

  _onrequest (server, req, res) {
    const app = this.apps.get(req.headers.host)

    if (this.log) this._logRequest(req)

    if (!app) {
      res.connection.destroy()
      return
    }

    if (this.insecureServer === server && app.secureContext) {
      res.writeHead(301, { Location: 'https://' + req.headers.host + req.url })
      res.end()
      return
    }

    /* if (app.www && req.headers.host.indexOf('www.') === -1) {
      res.writeHead(301, { Location: 'https://www.' + req.headers.host + req.url })
      res.end()
      return
    } */

    // TODO: ideally manual forward it without http-proxy
    this.proxy.web(req, res, { target: app.destination })
  }

  _getRemoteAddress (req) {
    if (this.behindProxy) {
      if (this.behindProxy === 'cf') return req.headers['cf-connecting-ip']

      return req.headers['x-forwarded-for'].split(',').shift()
    }

    return req.connection.remoteAddress
  }

  _logRequest (req) {
    const remoteAddress = this._getRemoteAddress(req)

    console.log(
      '- Request',
      '[' + (new Date().toLocaleString('en-GB')) + ']',
      '[' + remoteAddress, (this.behindProxy === 'cf' ? req.headers['cf-ipcountry'] : null) + ']',
      // req.headers,
      '[' + req.headers.host, req.method, req.url + ']',
      // req.body,
      reduceUA(req.headers['user-agent'])
    )
  }
}

module.exports = Hosting

function createSecureContext (cert, key) {
  // TODO: should be async
  return tls.createSecureContext({
    cert: fs.readFileSync(cert), // => fullchain.pem
    key: fs.readFileSync(key) // => privkey.pem
  })
}
