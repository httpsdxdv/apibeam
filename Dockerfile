FROM node:20-alpine AS build
WORKDIR /src

COPY package.json ./
RUN npm install --legacy-peer-deps

COPY . .
RUN npm run build:firefox && npm run build:chrome

FROM alpine:3.20
COPY --from=build /src/dist_firefox /dist_firefox
COPY --from=build /src/dist_chrome /dist_chrome

ENV APIBEAM_BROWSER=firefox
CMD ["sh", "-c", "set -eu; mkdir -p /out; rm -rf /out/*; if [ \"$APIBEAM_BROWSER\" = \"chrome\" ]; then cp -a /dist_chrome/. /out/; echo 'ApiBeam Chrome extension built in the configured host output folder.'; else cp -a /dist_firefox/. /out/; echo 'ApiBeam Firefox extension built in the configured host output folder.'; fi"]
