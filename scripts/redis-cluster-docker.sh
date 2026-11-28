#!/usr/bin/env bash
# A local Redis Cluster for the cluster specs and e2e (#1503): six redis-server processes in one
# container (3 masters, 3 replicas), each published on the same host port, so a client on the host
# reaches every node at the address the cluster announces.
#
#   scripts/redis-cluster-docker.sh up      # start it; prints the REDIS_CLUSTER_NODES to export
#   scripts/redis-cluster-docker.sh down    # remove it
#
# Environment:
#   REDIS_CLUSTER_PORT   first port (default 7101; 7000 is taken by macOS AirPlay)
#   REDIS_CLUSTER_NAME   container name (default frontmcp-redis-cluster)
#   REDIS_CLUSTER_IMAGE  image (default redis:7.2)
#   REDIS_CLUSTER_PASSWORD  requirepass/masterauth for every node (default: none)
#   REDIS_CLUSTER_ANNOUNCE  announce nodes by hostname instead of IP, as ElastiCache does: set to the
#                           hostname (e.g. localhost); the nodes then report it in CLUSTER SLOTS.
#   REDIS_CLUSTER_TLS_DIR   serve TLS only, with ca.crt / redis.crt / redis.key from this directory
#
# CI: run `scripts/redis-cluster-docker.sh up` in a job with Docker, then export the printed
# REDIS_CLUSTER_NODES before the jest run; the cluster specs skip when it is unset.
set -euo pipefail

FIRST_PORT="${REDIS_CLUSTER_PORT:-7101}"
NAME="${REDIS_CLUSTER_NAME:-frontmcp-redis-cluster}"
IMAGE="${REDIS_CLUSTER_IMAGE:-redis:7.2}"
PASSWORD="${REDIS_CLUSTER_PASSWORD:-}"
ANNOUNCE="${REDIS_CLUSTER_ANNOUNCE:-}"
TLS_DIR="${REDIS_CLUSTER_TLS_DIR:-}"
LAST_PORT=$((FIRST_PORT + 5))

down() {
  docker rm -f "$NAME" >/dev/null 2>&1 || true
}

up() {
  down
  local mounts=()
  if [ -n "$TLS_DIR" ]; then mounts=(-v "$TLS_DIR:/tls:ro"); fi

  # Published on loopback only: the nodes run without protected mode, and without a password by default.
  # The nodes' cluster bus ports (port + 10000) stay inside the container.
  docker run -d --name "$NAME" "${mounts[@]+"${mounts[@]}"}" \
    -p "127.0.0.1:$FIRST_PORT-$LAST_PORT:$FIRST_PORT-$LAST_PORT" \
    -e FIRST_PORT="$FIRST_PORT" -e PASSWORD="$PASSWORD" -e ANNOUNCE="$ANNOUNCE" -e TLS="${TLS_DIR:+1}" \
    --entrypoint sh "$IMAGE" -c '
      set -e
      for port in $(seq "$FIRST_PORT" $((FIRST_PORT + 5))); do
        mkdir -p "/data/$port"
        args="--dir /data/$port --cluster-enabled yes --cluster-config-file nodes.conf --cluster-node-timeout 5000 --appendonly no --save \"\" --protected-mode no --bind 0.0.0.0"
        if [ -n "$TLS" ]; then
          args="$args --port 0 --tls-port $port --tls-cert-file /tls/redis.crt --tls-key-file /tls/redis.key --tls-ca-cert-file /tls/ca.crt --tls-cluster yes --tls-replication yes --tls-auth-clients no"
        else
          args="$args --port $port"
        fi
        if [ -n "$PASSWORD" ]; then args="$args --requirepass $PASSWORD --masterauth $PASSWORD"; fi
        if [ -n "$ANNOUNCE" ]; then
          args="$args --cluster-announce-hostname $ANNOUNCE --cluster-preferred-endpoint-type hostname"
        fi
        eval redis-server $args --daemonize yes --logfile "/data/$port/redis.log"
      done
      sleep infinity
    ' >/dev/null

  local cli=(docker exec "$NAME" redis-cli)
  if [ -n "$TLS_DIR" ]; then cli+=(--tls --cacert /tls/ca.crt); fi
  if [ -n "$PASSWORD" ]; then cli+=(-a "$PASSWORD" --no-auth-warning); fi

  for port in $(seq "$FIRST_PORT" "$LAST_PORT"); do
    for _ in $(seq 1 50); do
      if "${cli[@]}" -p "$port" ping 2>/dev/null | grep -q PONG; then break; fi
      sleep 0.2
    done
  done

  local nodes=()
  for port in $(seq "$FIRST_PORT" "$LAST_PORT"); do nodes+=("127.0.0.1:$port"); done
  "${cli[@]}" --cluster create "${nodes[@]}" --cluster-replicas 1 --cluster-yes >/dev/null

  for _ in $(seq 1 100); do
    if "${cli[@]}" -p "$FIRST_PORT" cluster info 2>/dev/null | grep -q 'cluster_state:ok'; then
      echo "REDIS_CLUSTER_NODES=$(IFS=,; echo "${nodes[*]}")"
      return 0
    fi
    sleep 0.2
  done
  echo "the cluster did not reach cluster_state:ok" >&2
  docker logs "$NAME" >&2 || true
  return 1
}

case "${1:-up}" in
  up) up ;;
  down) down ;;
  *) echo "usage: $0 up|down" >&2; exit 2 ;;
esac
