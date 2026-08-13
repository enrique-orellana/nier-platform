FROM golang:1.26-alpine AS build

WORKDIR /src
COPY go.mod ./
COPY cmd ./cmd
COPY internal ./internal

RUN CGO_ENABLED=0 go build -trimpath -ldflags="-s -w" -o /out/openshorts-control-plane ./cmd/api

FROM alpine:3.22

RUN addgroup -S appuser && adduser -S -G appuser appuser
COPY --from=build /out/openshorts-control-plane /usr/local/bin/openshorts-control-plane

USER appuser
EXPOSE 8000
ENTRYPOINT ["/usr/local/bin/openshorts-control-plane"]
