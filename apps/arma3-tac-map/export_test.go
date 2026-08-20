package main

import (
	"strings"
	"testing"
)

func TestExportAETSelectedLayersAndCoordinateOrder(t *testing.T) {
	point := Point{123.5, 456.25}
	value := Map{Layers: []Layer{{ID: "hidden", Position: 0, Annotations: []Annotation{{ID: "skip", LayerID: "hidden", Kind: "marker", Color: "ColorBlack", Icon: "mil_dot", Point: &point, Scale: 1}}}, {ID: "visible", Position: 1, Annotations: []Annotation{{ID: "line", LayerID: "visible", Kind: "polyline", Color: "colorBLUFOR", Points: []Point{{1, 2}, {3, 4}}}, {ID: "marker", LayerID: "visible", Kind: "marker", Color: "ColorRed", Icon: "mil_warning", Point: &point, Label: `Say "go"`, Rotation: 90, Scale: 1.5}}}}}
	output, err := exportAET(value, []string{"visible"})
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{`private _data = [[["marker",123.5,456.25,"mil_warning","ColorRed","Say ""go""",90,1.5]],[["line",[1,2,3,4],"colorBLUFOR"]],[]];`, `_data params ['_icons', '_poly', '_metis'];`} {
		if !strings.Contains(output, expected) {
			t.Errorf("missing %q in:\n%s", expected, output)
		}
	}
	if strings.Contains(output, "skip") {
		t.Fatal("unselected layer exported")
	}
}

func TestAnnotationRejectsControlLabel(t *testing.T) {
	point := Point{1, 2}
	annotation := Annotation{Kind: "marker", Color: "ColorBlack", Icon: "mil_dot", Point: &point, Scale: 1, Label: "bad\nlabel"}
	if annotation.validate() == nil {
		t.Fatal("expected control character rejection")
	}
}

func TestExportAETEmptySelectionExportsNoAnnotations(t *testing.T) {
	point := Point{1, 2}
	value := Map{Layers: []Layer{{ID: "layer", Annotations: []Annotation{{ID: "marker", LayerID: "layer", Kind: "marker", Color: "ColorBlack", Icon: "mil_dot", Point: &point, Scale: 1}}}}}
	output, err := exportAET(value, []string{})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(output, "private _data = [[],[],[]];") {
		t.Fatalf("unexpected empty export: %s", output)
	}
}
