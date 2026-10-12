package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestTheDefaultLentDirectoryIsTheCurrentOne(t *testing.T) {
	want, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	want, err = filepath.Abs(want)
	if err != nil {
		t.Fatal(err)
	}

	got, err := defaultDirs()
	if err != nil {
		t.Fatal(err)
	}
	if len(got) != 1 || got[0] != want {
		t.Fatalf("default directories = %v, want [%s]", got, want)
	}
}

func TestAllDirectoriesCanBeExplicitlyShared(t *testing.T) {
	dirs := list{"*", t.TempDir()}
	if err := resolveDirs(dirs); err != nil {
		t.Fatal(err)
	}
	if dirs[0] != "*" {
		t.Fatalf("wildcard changed to %q", dirs[0])
	}
}
