package main

import (
	"encoding/json"
	"errors"
	"strings"
	"unicode/utf8"
)

const (
	maxLayers      = 100
	maxAnnotations = 10_000
	maxPoints      = 2_000
	maxLabelLength = 200
)

var allowedIcons = stringSet("mil_dot", "mil_objective", "mil_warning", "mil_start", "mil_end", "mil_pickup", "mil_destroy", "mil_ambush", "mil_arrow", "mil_circle", "mil_box", "mil_triangle", "mil_flag", "mil_unknown")
var allowedColors = stringSet("ColorBlack", "ColorGrey", "ColorRed", "ColorBrown", "ColorOrange", "ColorYellow", "ColorKhaki", "ColorGreen", "ColorBlue", "ColorPink", "ColorWhite", "ColorUNKNOWN", "colorBLUFOR", "colorOPFOR", "colorIndependent", "colorCivilian")

func stringSet(values ...string) map[string]bool {
	set := make(map[string]bool, len(values))
	for _, value := range values {
		set[value] = true
	}
	return set
}

type User struct {
	ID          string `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"displayName"`
	Avatar      string `json:"avatar,omitempty"`
	Admin       bool   `json:"admin"`
}

type Point [2]float64

type Annotation struct {
	ID       string  `json:"id"`
	MapID    string  `json:"mapId"`
	LayerID  string  `json:"layerId"`
	Kind     string  `json:"kind"`
	Position int     `json:"position"`
	Color    string  `json:"color"`
	Points   []Point `json:"points,omitempty"`
	Point    *Point  `json:"point,omitempty"`
	Icon     string  `json:"icon,omitempty"`
	Label    string  `json:"label,omitempty"`
	Rotation float64 `json:"rotation,omitempty"`
	Scale    float64 `json:"scale,omitempty"`
}

func (a Annotation) validate() error {
	if !allowedColors[a.Color] {
		return errors.New("unsupported color")
	}
	if utf8.RuneCountInString(a.Label) > maxLabelLength || containsControl(a.Label) {
		return errors.New("label must contain at most 200 printable characters")
	}
	switch a.Kind {
	case "polyline", "freehand":
		if len(a.Points) < 2 || len(a.Points) > maxPoints || a.Point != nil || a.Icon != "" {
			return errors.New("line requires 2 to 2000 points")
		}
	case "marker":
		if a.Point == nil || len(a.Points) != 0 || !allowedIcons[a.Icon] || a.Scale <= 0 {
			return errors.New("invalid marker")
		}
	default:
		return errors.New("unsupported annotation kind")
	}
	return nil
}

func containsControl(value string) bool {
	for _, r := range value {
		if r < 0x20 || r == 0x7f {
			return true
		}
	}
	return false
}

type Layer struct {
	ID          string       `json:"id"`
	MapID       string       `json:"mapId"`
	Name        string       `json:"name"`
	Position    int          `json:"position"`
	Annotations []Annotation `json:"annotations,omitempty"`
}

type Map struct {
	ID             string  `json:"id"`
	Name           string  `json:"name"`
	World          string  `json:"world"`
	CreatorID      string  `json:"creatorId"`
	Creator        *User   `json:"creator,omitempty"`
	Version        int64   `json:"version"`
	Deleted        bool    `json:"deleted"`
	WorldAvailable bool    `json:"worldAvailable"`
	Layers         []Layer `json:"layers,omitempty"`
}

type Revision struct {
	ID        int64           `json:"id"`
	MapID     string          `json:"mapId"`
	Version   int64           `json:"version"`
	Actor     User            `json:"actor"`
	Kind      string          `json:"kind"`
	Data      json.RawMessage `json:"data"`
	CreatedAt int64           `json:"createdAt"`
}

type event struct {
	Map        *Map        `json:"map,omitempty"`
	Layer      *Layer      `json:"layer,omitempty"`
	LayerIDs   []string    `json:"layerIds,omitempty"`
	Annotation *Annotation `json:"annotation,omitempty"`
	ID         string      `json:"id,omitempty"`
	Name       string      `json:"name,omitempty"`
	Snapshot   *Map        `json:"snapshot,omitempty"`
}

func validateName(name string) error {
	if strings.TrimSpace(name) == "" || utf8.RuneCountInString(name) > 200 || containsControl(name) {
		return errors.New("name must contain 1 to 200 printable characters")
	}
	return nil
}
