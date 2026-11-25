package main

import (
	"bytes"
	"fmt"
	"io"
	"os"

	"filippo.io/age"
)

func run() error {
	if len(os.Args) != 3 {
		return fmt.Errorf("invalid encryption invocation")
	}
	file, err := os.Open(os.Args[2])
	if err != nil {
		return err
	}
	defer file.Close()
	secret, err := io.ReadAll(io.LimitReader(file, 4097))
	if err != nil || len(secret) > 4096 || len(bytes.TrimSpace(secret)) < 32 {
		return fmt.Errorf("invalid backup passphrase")
	}
	passphrase := string(bytes.TrimSpace(secret))
	defer clear(secret)
	switch os.Args[1] {
	case "encrypt":
		recipient, err := age.NewScryptRecipient(passphrase)
		if err != nil {
			return err
		}
		writer, err := age.Encrypt(os.Stdout, recipient)
		if err != nil {
			return err
		}
		if _, err := io.Copy(writer, os.Stdin); err != nil {
			return err
		}
		return writer.Close()
	case "decrypt":
		identity, err := age.NewScryptIdentity(passphrase)
		if err != nil {
			return err
		}
		identity.SetMaxWorkFactor(20)
		reader, err := age.Decrypt(os.Stdin, identity)
		if err != nil {
			return err
		}
		_, err = io.Copy(os.Stdout, reader)
		return err
	default:
		return fmt.Errorf("invalid encryption operation")
	}
}

func main() {
	if err := run(); err != nil {
		fmt.Fprintln(os.Stderr, "Falha na operação criptográfica do backup.")
		os.Exit(1)
	}
}
