# Medis

---

The original [Medis](https://github.com/luin/medis) is a beautiful, easy-to-use Redis management application built on the modern web with [Electron](https://github.com/atom/electron), [React](https://facebook.github.io/react/), and [Redux](https://github.com/rackt/redux). This project forks, and ports Medis to [Tauri](https://tauri.app/) with some life quality improvements.

[![Commitizen friendly](https://img.shields.io/badge/commitizen-friendly-brightgreen.svg)](http://commitizen.github.io/cz-cli/)

Medis starts with all the basic features you need:

- Keys viewing/editing
- SSH Tunnel for connecting with remote servers
- Terminal for executing custom commands
- Config viewing/editing

It also supports many advanced features:

- JSON/MessagePack format viewing/editing and built-in highlighting/validator
- Working with millions keys and key members without blocking the redis server
- Pattern manager for easy selecting a sub group of keys.

**Note**: Medis only supports Redis >= 2.8 version because `SCAN` command was introduced since 2.8. `SCAN` is very useful to get key list without blocking the server, which is crucial to the production environment. Because the latest stable is 5.0 and 2.6 is a very old version, Medis doesn't support it.

## Requirements

- [Node.js](https://nodejs.org/) and [pnpm](https://pnpm.io/)
- [Rust](https://rustup.rs/) (stable toolchain)
- [Tauri prerequisites](https://tauri.app/start/prerequisites/) for your platform

## Running Locally

1. Install dependencies:
```sh
pnpm install
```
2. Start in development mode:
```sh
pnpm dev
```

## Building

```sh
pnpm build:tauri
```

The packaged app will be in `tauri/target/release/bundle/`.

## Connect to Heroku

Medis can connect to Heroku Redis addon to manage your data. You just need to call `heroku redis:credentials --app APP` to get your redis credential:

```shell
$ heroku redis:credentials --app YOUR_APP
redis://x:PASSWORD@HOST:PORT
```

And then input `HOST`, `PORT` and `PASSWORD` to the connection tab.

## License

MIT
