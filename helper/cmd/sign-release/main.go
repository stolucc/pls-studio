// sign-release: the release key of PLS Studio Helper's self-update.
//
//	go run ./cmd/sign-release keygen <private-key-file>
//	    makes a key pair: the private key (base64) into the file (mode 0600;
//	    keep it out of the repository: it becomes the HELPER_SIGNING_KEY
//	    secret) and the public key (base64) on stdout, for updatekey.go.
//	HELPER_SIGNING_KEY=<base64> go run ./cmd/sign-release sign <file>
//	    writes <file>.sig: the base64 Ed25519 signature of the file (the
//	    release workflow signs SHA256SUMS).
//	go run ./cmd/sign-release verify <public-key> <file>
//	    checks <file>.sig.
package main

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"fmt"
	"os"
	"strings"
)

func main() {
	if len(os.Args) < 3 {
		fail("usage: sign-release keygen <private-key-file> | sign <file> | verify <public-key> <file>")
	}
	switch os.Args[1] {
	case "keygen":
		pub, priv, err := ed25519.GenerateKey(rand.Reader)
		check(err)
		if _, err := os.Stat(os.Args[2]); err == nil {
			fail(os.Args[2] + " exists: not overwritten")
		}
		check(os.WriteFile(os.Args[2], []byte(base64.StdEncoding.EncodeToString(priv)+"\n"), 0o600))
		fmt.Println(base64.StdEncoding.EncodeToString(pub))
	case "sign":
		raw, err := base64.StdEncoding.DecodeString(strings.TrimSpace(os.Getenv("HELPER_SIGNING_KEY")))
		if err != nil || len(raw) != ed25519.PrivateKeySize {
			fail("HELPER_SIGNING_KEY is not a base64 Ed25519 private key")
		}
		data, err := os.ReadFile(os.Args[2])
		check(err)
		sig := ed25519.Sign(ed25519.PrivateKey(raw), data)
		check(os.WriteFile(os.Args[2]+".sig", []byte(base64.StdEncoding.EncodeToString(sig)+"\n"), 0o644))
	case "verify":
		if len(os.Args) < 4 {
			fail("usage: sign-release verify <public-key> <file>")
		}
		pub, err := base64.StdEncoding.DecodeString(os.Args[2])
		check(err)
		data, err := os.ReadFile(os.Args[3])
		check(err)
		sigText, err := os.ReadFile(os.Args[3] + ".sig")
		check(err)
		sig, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(sigText)))
		check(err)
		if len(pub) != ed25519.PublicKeySize || !ed25519.Verify(ed25519.PublicKey(pub), data, sig) {
			fail("signature NOT valid")
		}
		fmt.Println("signature valid")
	default:
		fail("unknown command " + os.Args[1])
	}
}

func check(err error) {
	if err != nil {
		fail(err.Error())
	}
}

func fail(msg string) {
	fmt.Fprintln(os.Stderr, msg)
	os.Exit(1)
}
