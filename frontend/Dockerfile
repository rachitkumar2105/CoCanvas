FROM node:20-alpine AS build
WORKDIR /app
COPY package.json ./
RUN npm install
COPY tsconfig.json next.config.mjs tailwind.config.ts postcss.config.mjs ./
COPY src src
ARG NEXT_PUBLIC_CORE_API_URL
ARG NEXT_PUBLIC_SYNC_SERVICE_WS_URL
ENV NEXT_PUBLIC_CORE_API_URL=$NEXT_PUBLIC_CORE_API_URL
ENV NEXT_PUBLIC_SYNC_SERVICE_WS_URL=$NEXT_PUBLIC_SYNC_SERVICE_WS_URL
RUN npm run build

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY package.json ./
RUN npm install --omit=dev
COPY --from=build /app/.next .next
COPY next.config.mjs ./
EXPOSE 3000
CMD ["npm", "start"]
