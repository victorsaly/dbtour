<img src="https://raw.githubusercontent.com/victorsaly/dbtour/main/brand/logo.svg" alt="dbtour" width="220">

**Where [dbtour](https://www.npmjs.com/package/dbtour) keeps passwords: the system's keychain.**

macOS Keychain, Windows Credential Manager, or the Secret Service on Linux, through
[`@napi-rs/keyring`](https://www.npmjs.com/package/@napi-rs/keyring). Each password is named after the
database it signs in to, "dbtour · Shop · login" or "dbtour · Shop · reader", so it can be found and
removed there too. dbtour writes none of them to a file, prints none and sends none to the page. It is a
package of its own so that dbtour's core keeps a single dependency.

Start in one line, with nothing installed: the browser opens on a page that sets a database up step by step.

```bash
npx -y -p dbtour -p dbtour-source-mssql -p dbtour-addon-explorer -p dbtour-keychain dbtour serve
```

Or from a terminal, for an agent or a script:

```bash
npm install -g dbtour dbtour-source-mssql dbtour-addon-explorer dbtour-keychain
dbtour add Shop --server shop-sql.database.windows.net
```

The rest is in the [full README](https://github.com/victorsaly/dbtour#readme). MIT licence.
