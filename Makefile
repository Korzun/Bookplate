IMAGE   := hass-odps:dev
PORT    := 3000
BOOKS   := $(HOME)/Books

.PHONY: build run stop logs shell clean dev dev-down

build:
	docker build -t $(IMAGE) .

run: build
	docker run -d --name hass-odps \
		-p $(PORT):3000 \
		-e ADMIN_USER=admin \
		-e ADMIN_PASS=changeme \
		-e BOOKS_DIR=/media/books \
		-v "$(BOOKS)":/media/books:rw \
		$(IMAGE)
	@echo "Running at http://localhost:$(PORT)"

stop:
	docker stop hass-odps && docker rm hass-odps

logs:
	docker logs -f hass-odps

shell:
	docker exec -it hass-odps sh

clean:
	docker rmi $(IMAGE) 2>/dev/null || true

# Dev: live-reload via docker compose (backend on :3000, frontend on :5173)
dev:
	BOOKS="$(BOOKS)" docker compose up --build

dev-down:
	docker compose down
