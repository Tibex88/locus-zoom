import React, { useEffect, useRef, useState } from "react";
import LocusZoom from "locuszoom";
import "locuszoom/dist/locuszoom.css";
import jsonData from "../../Data/hg-data_2_grch38.json";

// Parse input JSON into two things:
// 1) a flat list of variant objects for the association track
// 2) a deduped list of regions (from metadata) to drive the dropdown
const parseCredibleSets = (json) => {
  const variants = [];
  if (!json || !json.data) {
    console.error("JSON data is not in the expected format.");
    return { variants: [], regions: [] };
  }

  const regions = [];
  const uniqueRegions = new Set();

  for (const key in json.data) {
    // Credible sets may store variant data in "columnar" arrays; convert to row objects
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
    // Use region_lead_variant from metadata to seed dropdown options (efficient, deduped)
    if (
      json.data[key].metadata &&
      json.data[key].metadata.region_lead_variant
    ) {
      const lead_variant_str = json.data[key].metadata.region_lead_variant;
      const parts = lead_variant_str.split(":");
      const chr = parts[0];
      const position = parseInt(parts[1]);
      const regionKey = `${chr}:${position}`;
      if (!uniqueRegions.has(regionKey)) {
        uniqueRegions.add(regionKey);
        regions.push({ chr: chr, position: position });
      }
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
    // One-time plot initialization
    if (!plotRef.current) {
      return;
    }
    try {
      // Prepare data for the association layer and the dropdown
      const { variants, regions } = parseCredibleSets(jsonData);
      setAssociationData(variants);
      setRegions(regions);

      if (variants.length === 0) {
        console.error("No variants found in the data.");
        return;
      }

      // Configure data sources: local association data + remote annotations/LD
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

      // Start from the standard association + genes layout and tweak
      const association_panel = LocusZoom.Layouts.get("panel", "association", {
        title: { text: "Credible Set Variants" },
      });
      // Remove recombination rate layer (not needed for this view)
      association_panel.data_layers = association_panel.data_layers.filter(
        (layer) => layer.id !== "recombrate"
      );

      // Disable panning/zooming by user input; we control region via dropdown
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

      // Overall plot layout and bounds
      const layout = {
        width: 800,
        height: 600,
        responsive_resize: true,
        min_region_scale: 20000,
        max_region_scale: 1000000,
        panels: [association_panel, genes_panel],
      };

      // Create the plot
      const newPlot = LocusZoom.populate(plotRef.current, dataSources, layout);
      setPlot(newPlot);

      // Choose the most significant variant (highest log_pvalue) to set initial view
      let bestVariant = variants[0];
      for (let i = 1; i < variants.length; i++) {
        if (variants[i].log_pvalue > bestVariant.log_pvalue) {
          bestVariant = variants[i];
        }
      }

      // Center initial region +/- 50kb around the best variant
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
    // Update the view when a user chooses a new region from the dropdown
    const regionStr = event.target.value;
    if (plot && regionStr && associationData.length > 0) {
      const [selectedChr, selectedPosStr] = regionStr.split(":");
      const selectedPos = parseInt(selectedPosStr);

      // Find metadata for this region (e.g., window size)
      let regionMetadata = null;
      for (const key in jsonData.data) {
        if (
          jsonData.data[key].metadata &&
          String(jsonData.data[key].metadata.chr) === selectedChr &&
          jsonData.data[key].metadata.position === selectedPos
        ) {
          regionMetadata = jsonData.data[key].metadata;
          break;
        }
      }

      if (!regionMetadata) {
        console.warn(`Metadata for selected region ${regionStr} not found.`);
        return;
      }

      // Compute the region bounds using metadata (fallback handled below)
      const window_kb = regionMetadata.window_kb || 2000;
      const half_window_bp = (window_kb * 1000) / 2;
      const regionStart = selectedPos - half_window_bp;
      const regionEnd = selectedPos + half_window_bp;

      // Filter the local association data to variants in the chosen window
      const variantsInRegion = associationData.filter((variant) => {
        return (
          String(variant.chromosome) === selectedChr &&
          variant.position >= regionStart &&
          variant.position <= regionEnd
        );
      });

      if (variantsInRegion.length === 0) {
        console.warn(
          `No variants found in the calculated region for ${regionStr}.`
        );
        // Fallback to a small +/- 50kb window centered on the position
        plot.applyState({
          chr: selectedChr,
          start: selectedPos - 50000,
          end: selectedPos + 50000,
        });
        return;
      }

      // Compute tighter bounds based on observed variant positions
      let minVariantPos = variantsInRegion[0].position;
      let maxVariantPos = variantsInRegion[0].position;

      for (let i = 1; i < variantsInRegion.length; i++) {
        if (variantsInRegion[i].position < minVariantPos) {
          minVariantPos = variantsInRegion[i].position;
        }
        if (variantsInRegion[i].position > maxVariantPos) {
          maxVariantPos = variantsInRegion[i].position;
        }
      }

      // Add a small buffer for better visualization
      const buffer = 10000;
      const finalStart = Math.max(0, minVariantPos - buffer);
      const finalEnd = maxVariantPos + buffer;

      plot.applyState({
        chr: selectedChr,
        start: finalStart,
        end: finalEnd,
      });
    }
  };

  return (
    <div>
      <h1 style={{ textAlign: "center" }}>
        LocusZoom Visualization from Local JSON
      </h1>
      <div>
        {/* Region selector controls the genomic window shown in the plot */}
        <label htmlFor="region-selector">Select a Region: </label>
        <select id="region-selector" onChange={handleRegionChange}>
          {regions.map((region, index) => (
            <option key={index} value={`${region.chr}:${region.position}`}>
              {`chr${region.chr}:${region.position}`}
            </option>
          ))}
        </select>
      </div>
      {/* LocusZoom will render the plot into this container */}
      <div id="lz-plot" ref={plotRef}></div>
    </div>
  );
};

export default LZoomLocal;
