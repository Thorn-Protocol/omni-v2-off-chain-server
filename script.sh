docker run --name rofl-thorn-omnifarming-container --platform linux/amd64 --volume ./:/src -it ghcr.io/oasisprotocol/rofl-dev:main
docker start rofl-thorn-omnifarming-container
docker exec -it rofl-thorn-omnifarming-container /bin/bash

