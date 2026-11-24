FROM alpine:3.24 AS build
RUN apk add --no-cache build-base curl libevent-dev openssl-dev
WORKDIR /build
RUN curl --fail --silent --show-error --location \
      https://www.pgbouncer.org/downloads/files/1.26.1/pgbouncer-1.26.1.tar.gz -o pgbouncer.tar.gz \
    && printf '%s\n' '00886a2994b4844cd37110970df777772cfc42a74c400522c82fba509a3f42d9  pgbouncer.tar.gz' | sha256sum -c - \
    && tar -xzf pgbouncer.tar.gz --strip-components=1 \
    && ./configure --prefix=/usr/local \
    && make -j2 pgbouncer

FROM alpine:3.24 AS runner
ARG ORBIT_COMMIT_SHA=development
ARG ORBIT_BUILD_TIME
LABEL org.opencontainers.image.revision=$ORBIT_COMMIT_SHA \
      org.opencontainers.image.created=$ORBIT_BUILD_TIME
RUN apk add --no-cache libevent libssl3 libcrypto3 postgresql17-client \
    && addgroup -g 1001 pgbouncer \
    && adduser -D -H -u 1001 -G pgbouncer pgbouncer \
    && mkdir -p /run/pgbouncer \
    && chown 1001:1001 /run/pgbouncer
COPY --from=build /build/pgbouncer /usr/local/bin/pgbouncer
COPY --chmod=0755 entrypoint.sh /usr/local/bin/orbit-pgbouncer
USER 1001:1001
ENTRYPOINT ["/usr/local/bin/orbit-pgbouncer"]
