FROM node:20-alpine

WORKDIR /app

# Build-time API base URL, usually an HTTPS endpoint in deployed builds.
ARG NEXT_PUBLIC_API_BASE
ENV NEXT_PUBLIC_API_BASE=${NEXT_PUBLIC_API_BASE}

COPY package*.json ./
RUN npm ci

# Copy the application source after dependencies for better layer caching.
COPY . .

RUN npm run build

EXPOSE 3000
CMD ["npm", "start"]
