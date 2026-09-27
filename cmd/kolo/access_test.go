package main

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/whosgotch/kolo/internal/hub"
)

func accessOrg(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "org.json")
	if _, err := hub.Init(path, "acme"); err != nil {
		t.Fatal(err)
	}
	return path
}

func quietCommand(t *testing.T, run func() error) error {
	t.Helper()
	out, err := os.CreateTemp(t.TempDir(), "output")
	if err != nil {
		t.Fatal(err)
	}
	previous := os.Stdout
	os.Stdout = out
	defer func() { os.Stdout = previous; out.Close() }()
	return run()
}

func TestInviteReadOnlyAccessAndRenewal(t *testing.T) {
	path := accessOrg(t)
	base := []string{"-org", path, "-id", "observers"}
	run := func(flags ...string) error {
		return quietCommand(t, func() error { return inviteCmd(append(append([]string{}, base...), flags...)) })
	}
	if err := run("-read-only"); err != nil {
		t.Fatal(err)
	}
	org, err := hub.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	first, _ := org.Invite("observers")
	if !first.ReadOnly {
		t.Fatal("created a control invite instead of a read-only invite")
	}
	if err := run(); err != nil {
		t.Fatal(err)
	}
	if err := run("-read-only=false"); err == nil {
		t.Fatal("changed invite access without replacing the link")
	}
	org, _ = hub.Load(path)
	unchanged, _ := org.Invite("observers")
	if unchanged.Token != first.Token || !unchanged.ReadOnly {
		t.Fatal("showing or refusing an access change altered the invite")
	}
	if err := run("-new"); err != nil {
		t.Fatal(err)
	}
	org, _ = hub.Load(path)
	renewed, _ := org.Invite("observers")
	if !renewed.ReadOnly || renewed.Token == first.Token {
		t.Fatal("renewal did not preserve read-only access with a fresh token")
	}
	if err := run("-new", "-read-only=false"); err != nil {
		t.Fatal(err)
	}
	org, _ = hub.Load(path)
	changed, _ := org.Invite("observers")
	if changed.ReadOnly || changed.Token == renewed.Token {
		t.Fatal("explicit access change did not replace the link")
	}
}

func TestStandingInvitePreservesReadOnlyAfterExpiry(t *testing.T) {
	path := accessOrg(t)
	org, _, err := hub.SetReadOnlyInvite(path, standingID, time.Now().Add(-time.Hour), 10)
	if err != nil {
		t.Fatal(err)
	}
	_, invite, minted, err := standingInvite(path, org)
	if err != nil || !minted || !invite.ReadOnly || invite.Spent(time.Now()) {
		t.Fatalf("standing invite: %+v minted=%v err=%v", invite, minted, err)
	}
}

func TestReadOnlyTokenAndHostRejection(t *testing.T) {
	path := accessOrg(t)
	if err := quietCommand(t, func() error {
		return tokenCmd([]string{"-org", path, "-id", "observer", "-read-only"})
	}); err != nil {
		t.Fatal(err)
	}
	if err := tokenCmd([]string{"-org", path, "-id", "machine", "-read-only", "-host"}); err == nil {
		t.Fatal("allowed read-only host credentials")
	}
	org, err := hub.Load(path)
	if err != nil {
		t.Fatal(err)
	}
	m, ok := org.Member("observer")
	if !ok || !m.ReadOnly || len(org.Hosts) != 0 {
		t.Fatalf("unexpected credentials: member=%+v hosts=%d", m, len(org.Hosts))
	}
}
