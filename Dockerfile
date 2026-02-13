FROM node:24.13.1-alpine AS builder
WORKDIR /usr/src/app
COPY package*.json /usr/src/app/
RUN --mount=type=cache,target=.npm npm install --cache .npm
COPY tsconfig.json /usr/src/app
COPY src /usr/src/app/src
RUN npx tsc
RUN find . -name "*.ts" -type f -delete

FROM node:24.13.1-alpine
WORKDIR /usr/src/app
COPY package*.json /usr/src/app/
RUN --mount=type=cache,target=.npm npm install --production --cache .npm
COPY --from=builder /usr/src/app/src /usr/src/app/src
ENTRYPOINT ["node", "/usr/src/app/src/index.js"]
