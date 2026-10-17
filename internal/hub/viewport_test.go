package hub

import "testing"

func TestOnlyTypingConnectionMayResizeEvenForTwoTabsOfOneMember(t *testing.T) {
	ctx := testContext(t)
	s, token, hostToken := hubFixture(t)
	host := joinAsHost(t, ctx, s, hostToken)
	waitFor(t, func() bool { return len(s.Registry().Hosts()) == 1 })
	create(t, s, token, `{"name":"checkups","host":"devbox","dir":"/work/api","command":"claude"}`)
	var spawned spawn
	readFrame(t, ctx, host, &spawned)
	openScreen(t, ctx, s, hostToken, "checkups")
	waitFor(t, func() bool { _, ok := s.screens.get("checkups"); return ok })
	first := watch(t, ctx, s, token, "checkups")
	second := watch(t, ctx, s, token, "checkups")
	var firstID, secondID struct{ Type, ID string }
	readFrame(t, ctx, first, &firstID)
	readFrame(t, ctx, second, &secondID)
	if firstID.Type != "viewer" || secondID.Type != "viewer" || firstID.ID == "" || firstID.ID == secondID.ID {
		t.Fatal("tabs did not receive distinct connection IDs")
	}
	if err := write(ctx, first, viewerMessage{Type: "keys", Keys: "a", Cols: 160, Rows: 40}); err != nil {
		t.Fatal(err)
	}
	var got toAgent
	readFrame(t, ctx, host, &got)
	if got.Type != "keys" || got.Viewer != firstID.ID || got.Cols != 160 || got.Rows != 40 {
		t.Fatalf("first input: %+v", got)
	}
	waitFor(t, func() bool { return s.typists.viewer("checkups") == firstID.ID })
	// Both frames use one socket, so receipt of keys proves that its earlier
	// passive resize was processed and discarded, without a timing sleep.
	if err := write(ctx, second, viewerMessage{Type: "resize", Cols: 20, Rows: 10}); err != nil {
		t.Fatal(err)
	}
	if err := write(ctx, second, viewerMessage{Type: "keys", Keys: "b", Cols: 80, Rows: 24}); err != nil {
		t.Fatal(err)
	}
	readFrame(t, ctx, host, &got)
	if got.Type != "keys" || got.Viewer != secondID.ID || got.Cols != 80 || got.Rows != 24 {
		t.Fatalf("passive resize reached host or second input lost geometry: %+v", got)
	}
	waitFor(t, func() bool { return s.typists.viewer("checkups") == secondID.ID })
	if err := write(ctx, second, viewerMessage{Type: "resize", Cols: 90, Rows: 30}); err != nil {
		t.Fatal(err)
	}
	readFrame(t, ctx, host, &got)
	if got.Type != "resize" || got.Cols != 90 {
		t.Fatalf("active browser cannot resize: %+v", got)
	}
	if err := write(ctx, first, viewerMessage{Type: "keys", Keys: "invalid", Cols: 900, Rows: 30}); err != nil {
		t.Fatal(err)
	}
	if err := write(ctx, first, viewerMessage{Type: "resize", Cols: 20, Rows: 10}); err != nil {
		t.Fatal(err)
	}
	if err := write(ctx, first, viewerMessage{Type: "keys", Keys: "c", Cols: 100, Rows: 32}); err != nil {
		t.Fatal(err)
	}
	readFrame(t, ctx, host, &got)
	if got.Type != "keys" || got.Keys != "c" || got.Viewer != firstID.ID {
		t.Fatalf("invalid geometry or passive resize reached host: %+v", got)
	}
}
