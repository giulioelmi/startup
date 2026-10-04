FROM node:22-slim
WORKDIR /app
COPY . .
RUN npm ci && npm run build
ENV NODE_ENV=production DATA_DIR=/data
VOLUME /data
EXPOSE 3000
CMD ["npm", "start"]
