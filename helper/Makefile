# pls-studio-helper build targets. `make sync-r` copies PLS Studio's R bridge
# (../src/rengine/R) into rsrc/, which is embedded in the binary; the tests
# fail when the two differ.

BINARY := pls-studio-helper
VERSION := $(shell git describe --tags --always --dirty 2>/dev/null || echo 0.1.0-dev)
BUILD_SHA := $(shell git rev-parse --short HEAD 2>/dev/null || echo dev)
BUILD_TIME := $(shell date -u +%FT%TZ)
LDFLAGS := -s -w -X main.helperVersion=$(VERSION) -X main.helperBuildSHA=$(BUILD_SHA) -X main.helperBuildTime=$(BUILD_TIME)
GOFLAGS := -trimpath -ldflags "$(LDFLAGS)"
APP_NAME := PLS Studio Helper
# macOS: the oldest macOS the binary runs on (Go needs 13; as LSMinimumSystemVersion in
# scripts/build-app.sh); otherwise it requires the build machine's version.
export MACOSX_DEPLOYMENT_TARGET ?= 13.0
ifeq ($(shell uname -s),Darwin)
# (as compiler flags too: they are part of Go's build cache key)
export CGO_CFLAGS ?= -O2 -g -mmacosx-version-min=$(MACOSX_DEPLOYMENT_TARGET)
export CGO_LDFLAGS ?= -O2 -g -mmacosx-version-min=$(MACOSX_DEPLOYMENT_TARGET)
endif

.PHONY: all build sync-r test security clean dist app-mac-arm64 dmg-mac-arm64

all: build

sync-r:
	rm -f rsrc/*.R
	cp ../src/rengine/R/*.R rsrc/

build: sync-r
	go build $(GOFLAGS) -o $(BINARY) .

test: sync-r
	go test ./...

# The full check that request values can never become R code (minutes;
# needs R with PLS Studio's packages, e.g. after ./pls-studio-helper setup:
# R_LIBS=~/.pls-studio-helper/library make security).
security: sync-r
	PS_INJECTION=1 go test -run TestBridge_NoRCodeInjection -v -timeout 60m ./...

clean:
	rm -f $(BINARY)
	rm -rf dist

dist: sync-r
	@mkdir -p dist
	GOOS=darwin GOARCH=arm64 go build $(GOFLAGS) -o dist/$(BINARY)-darwin-arm64 .
	GOOS=darwin GOARCH=amd64 go build $(GOFLAGS) -o dist/$(BINARY)-darwin-amd64 .
	GOOS=linux GOARCH=amd64 go build $(GOFLAGS) -o dist/$(BINARY)-linux-amd64 .
	GOOS=windows GOARCH=amd64 go build -trimpath -ldflags "$(LDFLAGS) -H=windowsgui" -o dist/$(BINARY)-windows-amd64.exe .

# macOS menu-bar app (LSUIElement: no Dock icon), ad-hoc signed.
app-mac-arm64: sync-r
	@mkdir -p dist
	GOOS=darwin GOARCH=arm64 go build $(GOFLAGS) -o dist/$(BINARY)-darwin-arm64 .
	./scripts/build-app.sh dist/$(BINARY)-darwin-arm64 "dist/$(APP_NAME).app" arm64

dmg-mac-arm64: app-mac-arm64
	hdiutil create -volname "$(APP_NAME)" -srcfolder "dist/$(APP_NAME).app" -ov -format UDZO "dist/$(APP_NAME)-arm64.dmg"
