// Package contenthash computes SHA-256 keys for JSON content that do not
// depend on object key order or whitespace, so equal inputs always get equal
// keys. Stored results are looked up and judged current by these keys.
package contenthash

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
)

// Canonical re-encodes raw JSON with object keys sorted and insignificant
// whitespace removed. Numbers keep their original text, so 1 and 1.0 encode
// differently: a mismatch makes a result look stale and re-run, never makes a
// different input look current.
func Canonical(raw []byte) ([]byte, error) {
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	var v any
	if err := dec.Decode(&v); err != nil {
		return nil, fmt.Errorf("decode JSON for canonical form: %w", err)
	}
	if err := dec.Decode(&struct{}{}); !errors.Is(err, io.EOF) {
		return nil, errors.New("decode JSON for canonical form: data after the first value")
	}
	// encoding/json writes map keys in sorted order.
	out, err := json.Marshal(v)
	if err != nil {
		return nil, fmt.Errorf("encode canonical JSON: %w", err)
	}
	return out, nil
}

// Of returns the hex SHA-256 of v's canonical JSON encoding. v is anything
// encoding/json accepts, including json.RawMessage.
func Of(v any) (string, error) {
	raw, err := json.Marshal(v)
	if err != nil {
		return "", fmt.Errorf("encode value for hashing: %w", err)
	}
	canonical, err := Canonical(raw)
	if err != nil {
		return "", err
	}
	sum := sha256.Sum256(canonical)
	return hex.EncodeToString(sum[:]), nil
}
