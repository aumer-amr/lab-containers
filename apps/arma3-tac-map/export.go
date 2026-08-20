package main

import (
	"errors"
	"fmt"
	"sort"
	"strconv"
	"strings"
)

// Export layout follows MIT-licensed Arma3TacMap's PLANOPS exporter data model.
// See THIRD_PARTY_NOTICES.md. Implementation is independent Go code.
func exportAET(value Map, selected []string) (string, error) {
	selectedSet := make(map[string]bool, len(selected))
	for _, id := range selected {
		selectedSet[id] = true
	}
	layers := append([]Layer(nil), value.Layers...)
	sort.Slice(layers, func(i, j int) bool {
		return layers[i].Position < layers[j].Position || layers[i].Position == layers[j].Position && layers[i].ID < layers[j].ID
	})
	var icons, lines []string
	for _, layer := range layers {
		if !selectedSet[layer.ID] {
			continue
		}
		annotations := append([]Annotation(nil), layer.Annotations...)
		sort.Slice(annotations, func(i, j int) bool {
			return annotations[i].Position < annotations[j].Position || annotations[i].Position == annotations[j].Position && annotations[i].ID < annotations[j].ID
		})
		for _, a := range annotations {
			if err := a.validate(); err != nil {
				return "", fmt.Errorf("annotation %s: %w", a.ID, err)
			}
			switch a.Kind {
			case "marker":
				icons = append(icons, fmt.Sprintf(`[%s,%s,%s,%s,%s,%s,%s,%s]`, sqfString(a.ID), number(a.Point[0]), number(a.Point[1]), sqfString(a.Icon), sqfString(a.Color), sqfString(a.Label), number(a.Rotation), number(a.Scale)))
			case "polyline", "freehand":
				points := make([]string, 0, len(a.Points)*2)
				for _, point := range a.Points {
					points = append(points, number(point[0]), number(point[1]))
				}
				lines = append(lines, fmt.Sprintf(`[%s,[%s],%s]`, sqfString(a.ID), strings.Join(points, ","), sqfString(a.Color)))
			}
		}
	}
	data := fmt.Sprintf("[[%s],[%s],[]]", strings.Join(icons, ","), strings.Join(lines, ","))
	return "private _data = " + data + ";\n\n" + `_data params ['_icons', '_poly', '_metis'];

if (!isNil 'gtd_map_allMarkers') then { { deleteMarker _x; } forEach gtd_map_allMarkers; };
if (!isNil 'gtd_map_allMetisMarkers') then { { [_x] call mts_markers_fnc_deleteMarker; } forEach gtd_map_allMetisMarkers; };
gtd_map_allMarkers = [];
gtd_map_allMetisMarkers = [];

{
  _x params ['_id', '_points', '_color'];
  private _marker = createMarker [format ['_USER_DEFINED #%1/planops%2/0', clientOwner, _id], [0,0], 0];
  _marker setMarkerShape 'polyline';
  _marker setMarkerPolyline _points;
  _marker setMarkerColor _color;
  gtd_map_allMarkers pushBack _marker;
} forEach _poly;

{
  _x params ['_id', '_x', '_y', '_icon', '_color', '_text', '_rotate', ['_scale',1]];
  private _marker = createMarker [format ['_USER_DEFINED #%1/planops%2/0', clientOwner, _id], [_x,_y], 0];
  _marker setMarkerShape 'ICON';
  _marker setMarkerDir _rotate;
  _marker setMarkerColor _color;
  _marker setMarkerText _text;
  _marker setMarkerType _icon;
  _marker setMarkerSize [_scale,_scale];
  gtd_map_allMarkers pushBack _marker;
} forEach _icons;

publicVariable 'gtd_map_allMarkers';
publicVariable 'gtd_map_allMetisMarkers';`, nil
}

func sqfString(value string) string {
	if containsControl(value) {
		panic("validated SQF string contains control character")
	}
	return `"` + strings.ReplaceAll(value, `"`, `""`) + `"`
}
func number(value float64) string { return strconv.FormatFloat(value, 'f', -1, 64) }

func selectedLayerIDs(value Map, ids []string) error {
	known := map[string]bool{}
	for _, layer := range value.Layers {
		known[layer.ID] = true
	}
	for _, id := range ids {
		if !known[id] {
			return errors.New("unknown layer ID")
		}
	}
	return nil
}
