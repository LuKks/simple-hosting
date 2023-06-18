# simple-hosting

Simple reverse proxy for hosting multiple apps in the same server

```
npm i simple-hosting
```

## Usage

Let's say you already have two apps running in a server: `http://127.0.0.1:1337` and `http://127.0.0.1:3000`

Normally run this in a public server with DNS, and all app domains pointing to the same server IP.

```js
const Hosting = require('simple-hosting')

const hosting = new Hosting()

// Replace with your own domains
hosting.add('a.leet.ar', { destination: 'http://127.0.0.1:1337' })
hosting.add('b.leet.ar', { destination: 'http://127.0.0.1:3000' })

await hosting.listen({ securePort: false })

// Try making requests to http://127.0.0.1:80 and setting the Host header accordingly
// Or if this is in a server then use your browser to request the actual domains
```

Feel free to open an issue if you have any doubt.

## API

#### `const hosting = new Hosting([options])`

Creates a pair of servers that uses the `Host` header to dynamically load different apps.

```js
{
  log: false, // Enable requests logging
  behindProxy: false, // If hosting is behind CloudFlare or NGINX then enable this option
  auth: String // Secret token that must be sent in the request header "x-simple-hosting"
}
```

If you're not behind any kind of proxy then don't worry about the `auth` option.

If you're behind CloudFlare, NGINX, etc then to avoid spoofing headers you must use the `auth` option.

CloudFlare authentication:
- Go to Rules -> Transform Rules -> Modify Request Header.
- Create a rule for all incoming requests.
- Set the header name as `x-simple-hosting` with your secret auth token as value.

NGINX authentication:
- Configure it like `proxy_set_header x-simple-hosting <secret-auth-token>`

#### `hosting.add(servername, options)`

Add a new app to the hosting by its domain name.

Available `options`:
```js
{
  destination: String, // Target URL (required)
  cert: String, // Eg fullchain.pem
  key: String // Eg privkey.pem'
}
```

`cert` and `key` are used to create the secure context for the HTTPS server.

If you use CloudFlare in front of the hosting then you don't need to set the certificate and key.

Otherwise you can consider using [Certbot](https://certbot.eff.org/instructions?ws=other&os=ubuntufocal) for now.

#### `hosting.edit(servername, [options])`

Change the app configuration in real-time. For example, you could change the `destination` URL.

Same `options` as for adding an app.

#### `await hosting.listen([options])`

Start listening for new requests. Each hosting has two servers (HTTP and HTTPS).

Available `options`:
```js
{
  insecurePort: 80,
  securePort: 443 // Pass `false` to disable the HTTPS server
}
```

## License

MIT
