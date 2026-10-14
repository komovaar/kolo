package hub

import "github.com/whosgotch/kolo/internal/protocol"

type hostHello = protocol.HostHello

type viewerMessage struct {
	Cols int    `json:"cols"`
	Rows int    `json:"rows"`
	Type string `json:"type"`
	Keys string `json:"keys"`
}

type toAgent = protocol.AgentInput

type screenHello = protocol.ScreenHello

type hostWelcome = protocol.HostWelcome

type agentReport = protocol.AgentReport

type spawn = protocol.Spawn

type stop = protocol.Stop

type createRequest struct {
	Name    string `json:"name"`
	Host    string `json:"host"`
	Dir     string `json:"dir"`
	Command string `json:"command"`
}

type relabelRequest struct {
	Label string `json:"label"`
}

type listResponse struct {
	Org    string     `json:"org"`
	You    Person     `json:"you"`
	Hosts  []HostInfo `json:"hosts"`
	Agents []Agent    `json:"agents"`
}

const defaultEntries = 100

type logResponse struct {
	Persistent bool    `json:"persistent"`
	Entries    []Entry `json:"entries"`
}
