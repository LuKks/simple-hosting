# like-hosting

Simple reverse proxy for hosting multiple apps in the same server

```
npm i like-hosting
```

## Usage

```js
const Hosting = require('like-hosting')

const hosting = new Hosting()

hosting.add('a.leet.ar', { destination: 'http://127.0.0.1:1337' })
hosting.add('b.leet.ar', { destination: 'http://127.0.0.1:1338' })

hosting.listen(80)
```

## License

MIT
