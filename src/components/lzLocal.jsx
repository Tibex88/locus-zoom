import React, { useEffect, useRef, useState } from "react";
import LocusZoom from "locuszoom";
import "locuszoom/dist/locuszoom.css";
import jsonData from "../../Data/hg-data_2.json";

const parseCredibleSets = (json) => {
  const variants = [];
  if (!json || !json.data) {
    console.error("JSON data is not in the expected format.");
    return { variants: [], regions: [] };
  }

  const regions = Object.keys(json.data).map((key) => {
    const parts = key.split(":");
    return { chr: parts[0], position: parseInt(parts[1]) };
  });

  for (const key in json.data) {
    const credibleSets = json.data[key].credible_sets;
    if (credibleSets) {
      credibleSets.forEach((set) => {
        const variantData = set.variants.data;
        const keys = Object.keys(variantData);
        if (keys.length === 0) return;
        const numVariants = variantData[keys[0]].length;

        for (let i = 0; i < numVariants; i++) {
          const variant = {};
          keys.forEach((key) => {
            variant[key] = variantData[key][i];
          });
          variants.push(variant);
        }
      });
    }
  }
  return { variants, regions };
};

const LZoomLocal = () => {
  const plotRef = useRef(null);
  const [plot, setPlot] = useState(null);
  const [regions, setRegions] = useState([]);
  const [associationData, setAssociationData] = useState([]);

  useEffect(() => {
    if (!plotRef.current) {
      return;
    }
    try {
      const { variants, regions } = parseCredibleSets(jsonData);
      setAssociationData(variants);
      setRegions(regions);

      if (variants.length === 0) {
        console.error("No variants found in the data.");
        return;
      }

      const dataSources = new LocusZoom.DataSources()
        .add("assoc", ["StaticJSON", { data: variants }])
        .add("gene", [
          "GeneLZ",
          {
            url: "https://portaldev.sph.umich.edu/api/v1/annotation/genes/",
            build: "GRCh38",
          },
        ])
        .add("constraint", [
          "GeneConstraintLZ",
          { url: "https://gnomad.broadinstitute.org/api/", build: "GRCh38" },
        ])
        .add("ld", [
          "LDServer",
          {
            url: "https://portaldev.sph.umich.edu/ld/",
            source: "1000G",
            build: "GRCh38",
            population: "EUR",
          },
        ]);

      const association_panel = LocusZoom.Layouts.get("panel", "association", {
        title: { text: "Credible Set Variants" },
      });
      association_panel.data_layers = association_panel.data_layers.filter(
        (layer) => layer.id !== "recombrate"
      );

      association_panel.interaction = {
        drag_background_to_pan: false,
        scroll_to_zoom: false,
        drag_x_ticks_to_pan: false,
        drag_y_ticks_to_pan: false,
      };

      const genes_panel = LocusZoom.Layouts.get("panel", "genes");
      genes_panel.interaction = {
        drag_background_to_pan: false,
        scroll_to_zoom: false,
        drag_x_ticks_to_pan: false,
        drag_y_ticks_to_pan: false,
      };

      const layout = {
        width: 800,
        height: 600,
        responsive_resize: true,
        min_region_scale: 20000,
        max_region_scale: 1000000,
        panels: [association_panel, genes_panel],
      };

      const newPlot = LocusZoom.populate(plotRef.current, dataSources, layout);
      setPlot(newPlot);

      let bestVariant = variants[0];
      for (let i = 1; i < variants.length; i++) {
        if (variants[i].log_pvalue > bestVariant.log_pvalue) {
          bestVariant = variants[i];
        }
      }

      newPlot.applyState({
        chr: bestVariant.chromosome,
        start: bestVariant.position - 50000,
        end: bestVariant.position + 50000,
      });
    } catch (error) {
      console.error(
        "An error occurred during LocusZoom initialization:",
        error
      );
    }
  }, []);

  const handleRegionChange = (event) => {
    const regionStr = event.target.value;
    if (plot && regionStr) {
      const [chr, position] = regionStr.split(":");
      plot.applyState({
        chr: chr,
        start: parseInt(position) - 50000,
        end: parseInt(position) + 50000,
      });
    }
  };

  return (
    <div>
      <h1 style={{ textAlign: "center" }}>
        LocusZoom Visualization from Local JSON
      </h1>
      <div>
        <label htmlFor="region-selector">Select a Region: </label>
        <select id="region-selector" onChange={handleRegionChange}>
          {regions.map((region, index) => (
            <option key={index} value={`${region.chr}:${region.position}`}>
              {`chr${region.chr}:${region.position}`}
            </option>
          ))}
        </select>
      </div>
      <div id="lz-plot" ref={plotRef}></div>
    </div>
  );
};

export default LZoomLocal;
