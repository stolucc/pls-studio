package main

// updatePublicKey: the Ed25519 public key (base64) whose signature over a
// release's SHA256SUMS the self-update requires (update.go). The private key
// is the repository secret HELPER_SIGNING_KEY, used by the release workflow
// (helper/cmd/sign-release). Empty: this build cannot update itself.
// (A variable only so that tests can use a key of their own.)
var updatePublicKey = "JXTzPaoLMv8LR8wjI/c/6G3yb3/w53+RHvVOUtu9/c4="
