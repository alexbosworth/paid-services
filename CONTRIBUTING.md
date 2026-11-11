# Contributing

## Setup

- Node.js 22 or later.

## Tests

- `npm test` runs the unit tests with coverage. It must pass before a change
    is done.
- Integration tests need Docker. Run them one file at a time, for example
    `node --test test/integration/test_group.js`.
- A new top-level directory goes in `package.json` `files`, and its tests go
    in the `test` script.

## Unit tests

- Put the cases in a `tests` array of `{args, description, expected}`, with
    a short `tests.forEach` runner at the bottom of the file.
- When a file tests several functions, each case names its `method`.
- Results that are random or large go through a small summary helper, and
    repeated expectations come from a default object or a helper.
- Integration tests are scenarios in `test()` blocks, with `try`/`finally`
    so that the cluster is always killed.

## Code style

- Lines are at most 80 columns. A line can be longer when it has a string
    that does not fit, like a public key in hex.
- File names use underscores, like `get_offer_invoice.js`.
- Require blocks are alphabetical by identifier, ignoring case, with package
    requires first and local requires after them.
- Consts at the top of a file are one-liners. Anything longer goes in its
    own module, and a one-liner is not its own module.
- Put small checks in named helpers among the top consts, rather than inline
    `Number.`, `Array.`, or `Date` calls in a function body:

    ```js
    const {isArray} = Array;
    const isPast = date => new Date(date) < new Date();
    ```

- No inline construction or arithmetic, like `Array.from({length})` or `* 2`
    for a hex length. Use a helper such as `hexLength`.
- A line that does several things is split into steps.
- Don't destructure `args`. Reference `args.lnd` and so on. When any argument
    name has an underscore, take `args` rather than destructuring parameters.
- No ternary over more than one line. Use an early exit or a helper.
- Shorthand properties come first in an object literal.
- Don't index into an array to name a part of it, like `hops[0]`. Name the
    part where it is chosen.
- Don't name a variable `self`, `length`, `name`, or `find`.
- Use callbacks with `async` library methods (`async/auto`, `async/map`,
    `async/retry`) rather than `async`/`await`, `for` loops, or
    `Promise.all`. Public async methods return via `cbk` or a Promise, using
    `returnResult` from `asyncjs-util`.
- Parse inside one `try`:

    ```js
    try {
      return cbk(null, parse(args));
    } catch (err) {
      return cbk([400, err.message]);
    }
    ```

## Errors

- Errors are `[code, 'ErrorName']`, with HTTP-style codes: 400 for bad
    arguments, 503 for failures of LND or the network.
- Names are PascalCase and say what was expected and in which method, like
    `ExpectedLndToGetOfferInvoice`.
- Thrown errors in pure functions are `new Error('ErrorName')`.

## Comments

- Each method has a doc comment with a one-line summary, then only what a
    caller needs to call it and read its result, then its arguments and
    `@returns` (and `@throws` or `@event` when it has them).
- Arguments and results are listed in alphabetical order, with optional
    ones in brackets, like `[timeout]: <Milliseconds Number>`.
- Don't add "Requires ... permissions" lines.
- Explain code with short comments next to the code, like one above each
    `asyncAuto` step and helper, not with paragraphs in the doc comment.

## Modules

- `network/` holds onion message and blinded path plumbing, `offers/` the
    generic BOLT 12 payer, and `support/` the support protocol.
- `support/` may require `offers/` and `network/`, and `offers/` may require
    `network/`, never the other way.
- Generic helpers live in the lowest layer that needs them.

## Docs

- Docs and specs are in American English.
- Bullet continuation lines are indented 4 spaces.

## Versions and the CHANGELOG

- Versions follow semantic versioning. A change that breaks callers is a
    major version.
- Update the version in `package.json`, `package-lock.json`, and the
    `CHANGELOG.md` heading together.
- Each CHANGELOG entry names the method: ``- `payOffer`: Add `bip353_name` ``.
- Breaking changes go under `### Breaking Changes` in their version.
- Only methods exported from the root `index.js` go in the CHANGELOG.
