FROM node:8

WORKDIR /usr/src/app

ARG CACHEBUST=1

COPY . .

RUN yarn install

ENTRYPOINT ["node", "index.js"]
