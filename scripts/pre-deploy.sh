#!/usr/bin/env bash
#
# Description
# ===========
#
# Pre-deploy hook. Does the following:
#   1. Shows the commits about to be pushed
#   2. Ask for confirmation (exit with 1 if not confirming)
#   3. Notify Slack
#
#
# Developing
# ==========
#
# During development, the best way to test it is to call the script
# directly with `./scripts/pre-deploy.sh staging|production`. You can also set
# the `SLACK_CHANNEL` to your personnal channel so you don't flood the team.
# To do that, right click on your own name in Slack, `Copy link`, then
# only keep the last part of the URL.
#
# Or you can set `PUSH_TO_SLACK` to false to echo the payload instead of
# sending it.
#
# ------------------------------------------------------------------------------

if [ "$#" -ne 1 ]; then
  echo "Usage: [DEPLOY_MSG='An optional custom deploy message'] $0 staging|production"
  exit 1
fi

# ---- Variables ----

if [ "$1" == "staging" ]; then
  DEPLOY_ORIGIN_URL="https://git.heroku.com/oc-staging-watch.git"
elif [ "$1" == "production" ]; then
  DEPLOY_ORIGIN_URL="https://git.heroku.com/oc-prod-watch.git"
else
  echo "Unknwown remote $1"
  exit 1
fi

# Defaults, which the environment can override (see Developing above)
PUSH_TO_SLACK=${PUSH_TO_SLACK:-true} # false echoes the message instead of pushing it to Slack
SLACK_CHANNEL=${SLACK_CHANNEL:-"CEZUS9WH3"}

PRE_DEPLOY_ORIGIN="predeploy-${1}"

LOCAL_BRANCH="main"
PRE_DEPLOY_BRANCH="main"

GIT_LOG_FORMAT_SHELL='short'
GIT_LOG_FORMAT_SLACK='format:<https://github.com/opencollective/opencollective-watch/commit/%H|[%ci]> *%an* %n_%<(80,trunc)%s_%n'
# The local branch: it's what the deploy pushes
GIT_LOG_COMPARISON="$PRE_DEPLOY_ORIGIN/$PRE_DEPLOY_BRANCH..$LOCAL_BRANCH"
# Commits only on the deployed branch: a forced push (staging) removes them
GIT_LOG_REMOVED="$LOCAL_BRANCH..$PRE_DEPLOY_ORIGIN/$PRE_DEPLOY_BRANCH"

# ---- Utils ----

function confirm()
{
  echo -n "$@"
  read -e answer
  for response in y Y yes YES Yes Sure sure SURE OK ok Ok
  do
      if [ "$answer" == "$response" ]
      then
          return 0
      fi
  done

  # Any answer other than the list above is considerred a "no" answer
  return 1
}

function exit_success()
{
  echo "🚀  Deploying now..."
  exit 0
}

# ---- Ensure we have a reference to the remote ----

git remote add $PRE_DEPLOY_ORIGIN $DEPLOY_ORIGIN_URL &> /dev/null

# ---- Show the commits about to be pushed ----

# Update deploy remote
echo "ℹ️  Fetching remote $1 state..."
# Without the current state, the commits shown would be wrong: stop here
if ! git fetch $PRE_DEPLOY_ORIGIN $PRE_DEPLOY_BRANCH > /dev/null; then
  echo "⚠️  Couldn't fetch $1's state, not deploying."
  exit 1
fi

echo ""
echo "-------------- New commits --------------"
git --no-pager log --pretty="${GIT_LOG_FORMAT_SHELL}" $GIT_LOG_COMPARISON
echo "-----------------------------------------"
if [ -n "$(git log --oneline $GIT_LOG_REMOVED)" ]; then
  echo ""
  echo "--------- Commits removed from $1 ---------"
  git --no-pager log --pretty="${GIT_LOG_FORMAT_SHELL}" $GIT_LOG_REMOVED
  echo "-----------------------------------------"
fi
echo ""

# ---- Ask for confirmation ----

echo "ℹ️  You're about to deploy the preceding commits from main branch to $1 server."
confirm "❔ Are you sure (yes/no) > " || exit 1

# ---- Slack notification ----

cd -- "$(dirname $0)/.."
eval $(cat .env | grep OC_SLACK_DEPLOY_WEBHOOK=)

if [ -z "$OC_SLACK_DEPLOY_WEBHOOK" ]; then
  # Emit a warning as we don't want the deploy to crash just because we
  # havn't setup a Slack token. Get yours on https://api.slack.com/custom-integrations/legacy-tokens
  echo "ℹ️  OC_SLACK_DEPLOY_WEBHOOK is not set, I will not notify Slack about this deploy 😞  (please do it manually)"
  exit_success
fi

if [ ! -z "$DEPLOY_MSG" ]; then
  CUSTOM_MESSAGE="-- _${DEPLOY_MSG}_"
fi

# Built by a JSON encoder: the changelog spans several lines, and quotes in
# it or in the message must be escaped
PAYLOAD=$(
  SLACK_CHANNEL="$SLACK_CHANNEL" \
  TEXT=":rocket: Deploying *WATCH* to *${1}* ($(git config user.name)) ${CUSTOM_MESSAGE}" \
  CHANGELOG="$(git log --pretty="${GIT_LOG_FORMAT_SLACK}" $GIT_LOG_COMPARISON)" \
  REMOVED="$(git log --pretty="${GIT_LOG_FORMAT_SLACK}" $GIT_LOG_REMOVED)" \
  node -e '
    const { SLACK_CHANNEL, TEXT, CHANGELOG, REMOVED } = process.env;
    const removed = REMOVED ? `\n*Removed:*\n\n${REMOVED}\n` : "";
    console.log(JSON.stringify({
      channel: SLACK_CHANNEL,
      text: TEXT,
      as_user: true,
      attachments: [
        { text: `${"-".repeat(99)}\n\n${CHANGELOG}\n${removed}` },
      ],
    }));
  '
)

if [ $PUSH_TO_SLACK = "true" ]; then
  curl \
    -H "Content-Type: application/json; charset=utf-8" \
    -d "$PAYLOAD" \
    -s \
    --fail \
    "$OC_SLACK_DEPLOY_WEBHOOK" \
    &> /dev/null

  if [ $? -ne 0 ]; then
    echo "⚠️  I won't be able to notify slack. Please do it manually and check your OC_SLACK_DEPLOY_WEBHOOK"
  else
    echo "🔔  Slack notified about this deployment."
  fi
else
  echo "Following message would be posted on Slack:"
  echo "$PAYLOAD"
fi

# Always exit with 0 to continue the deploy even if slack notification failed
exit_success
