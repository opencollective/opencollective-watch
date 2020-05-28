# Open Collective Watch

## Foreword

If you see a step below that could be improved (or is outdated), please update the instructions. We rarely go through this process ourselves, so your fresh pair of eyes and your recent experience with it, makes you the best candidate to improve them for other users. Thank you!

## Usage

### Watching Open Collective API

Set the following environment variables in `.env`.

```
API_HYPERWATCH_URL={API_URL}/{HYPERWATCH_PATH}/logs/raw
API_HYPERWATCH_USERNAME={USERNAME}
API_HYPERWATCH_SECRET={SECRET}
```

Then, start with:

```
node api-graphql.js
```

You can browse the addresses metrics at:

http://localhost:3009/addresses.txt

### Using a development version of Hyperwatch

Clone and link Hyperwatch:

```
git clone git@github.com:znarf/hyperwatch.git
cd hyperwatch
npm install
npm link
```

Then link in the current project:

```
npm link @hyperwatch/hyperwatch
```

## Contributing

Code style? Commit convention?

TL;DR: we use [Prettier](https://prettier.io/) and [ESLint](https://eslint.org/), we do like great commit messages and clean Git history.

## Discussion

If you have any questions, ping us on Slack
(https://slack.opencollective.org) or on Twitter
([@opencollect](https://twitter.com/opencollect)).
