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

You can use the following the URL:

- see pipeline status: http://localhost:3009/status
- browse identities: http://localhost:3009/identities
- browse identities: http://localhost:3009/addresses
- watch real time logs: http://localhost:3009/logs/main

### Watching Open Collective Frontend

Set the following environment variables in `.env`.

```
FRONTEND_HYPERWATCH_URL={API_URL}/{HYPERWATCH_PATH}/logs/raw
FRONTEND_HYPERWATCH_USERNAME={USERNAME}
FRONTEND_HYPERWATCH_SECRET={SECRET}
```

Then, start with:

```
node frontend.js
```

### Watching Open Collective Images

Set the following environment variables in `.env`.

```
IMAGES_HYPERWATCH_URL={API_URL}/{HYPERWATCH_PATH}/logs/raw
IMAGES_HYPERWATCH_USERNAME={USERNAME}
IMAGES_HYPERWATCH_SECRET={SECRET}
```

Then, start with:

```
node images.js
```

### Watching Open Collective Rest

Set the following environment variables in `.env`.

```
REST_HYPERWATCH_URL={API_URL}/{HYPERWATCH_PATH}/logs/raw
REST_HYPERWATCH_USERNAME={USERNAME}
REST_HYPERWATCH_SECRET={SECRET}
```

Then, start with:

```
node rest.js
```

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
