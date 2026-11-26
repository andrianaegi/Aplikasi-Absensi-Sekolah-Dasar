FROM node:22-alpine
WORKDIR /app
COPY package.json server.js ./
COPY src ./src
COPY public ./public
ENV NODE_ENV=production PORT=3000 DB_PATH=/data/absensi.db TRUST_PROXY=1
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server.js"]
