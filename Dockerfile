#
# How to build using the latest git commit hash as a tag:
#
# if not already logged in:
#   gcloud login
#
# now build and push-- change DOCKER_IMAGE if you want to use a different container registry:
#   export COMMIT_SHA=$(git rev-parse HEAD)
#   export DOCKER_IMAGE=us.gcr.io/celo-testnet/celo-exchange-bot:$COMMIT_SHA
#   docker build -t $DOCKER_IMAGE .
#   docker push $DOCKER_IMAGE

FROM circleci/node:10
WORKDIR /celo-exchange-bot

RUN sudo apt-get update -y
RUN sudo apt-get install lsb-release libudev-dev libusb-dev libusb-1.0-0 -y

# ensure yarn.lock is evaluated by kaniko cache diff
COPY package.json yarn.lock ./

RUN sudo yarn install --frozen-lockfile --network-timeout 100000 && yarn cache clean

# Copy the rest
COPY . .

ENV NODE_ENV production

# build all
RUN sudo yarn build

WORKDIR /celo-exchange-bot
ENTRYPOINT ["node", "lib/index.js"]
