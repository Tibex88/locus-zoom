function install(LocusZoom) {
  const BaseUMAdapter = LocusZoom.Adapters.get("BaseUMAdapter");

  class LdServer extends BaseUMAdapter {
    constructor(t) {
      t.limit_fields ||
        (t.limit_fields = ["variant2", "position2", "correlation"]),
        super(t);
    }

    w(t, e = !1) {
      const v =
        /^(?:chr)?([a-zA-Z0-9]+?)[_:-](\d+)[_:|-]?(\w+)?[/_:|-]?([^_]+)?_?(.*)?/;
      const s = t && t.match(v);
      if (s) return s.slice(1);
      if (e) return null;
      throw new Error(
        `Could not understand marker format for ${t}. Should be of format chr:pos or chr:pos_ref/alt`
      );
    }
    __find_ld_refvar(t, e) {
      const s = this._findPrefixedKey(e[0], "variant"),
        i = this._findPrefixedKey(e[0], "log_pvalue");
      let a,
        n = {};
      if (t.ldrefvar) (a = t.ldrefvar), (n = e.find((t) => t[s] === a) || {});
      else {
        let t = 0;
        for (let o of e) {
          const { [s]: e, [i]: r } = o;
          r > t && ((t = r), (a = e), (n = o));
        }
      }
      n.lz_is_ld_refvar = !0;
      const o = this.w(a, !0);
      if (!o)
        throw new Error(
          "Could not request LD for a missing or incomplete marker format"
        );
      const [r, l, h, c] = o;
      (a = `${r}:${l}`), h && c && (a += `_${h}/${c}`);
      const d = +l;
      return d &&
        t.ldrefvar &&
        t.chr &&
        (r !== String(t.chr) || d < t.start || d > t.end)
        ? ((t.ldrefvar = null), this.__find_ld_refvar(t, e))
        : a;
    }
    _buildRequestOptions(t, e) {
      if (!e) throw new Error("LD request must depend on association data");
      const s = super._buildRequestOptions(...arguments);
      if (!e.length) return (s._skip_request = !0), s;
      s.ld_refvar = this.__find_ld_refvar(t, e);
      const i = t.genome_build || this._config.build || "GRCh37";
      let a = t.ld_source || this._config.source || "1000G";
      const n = t.ld_pop || this._config.population || "ALL";
      return (
        "1000G" === a && "GRCh38" === i && (a = "1000G-FRZ09"),
        this._validateBuildSource(i, null),
        Object.assign({}, s, {
          genome_build: i,
          ld_source: a,
          ld_population: n,
        })
      );
    }
    _getURL(t) {
      const e = this._config.method || "rsquare",
        {
          chr: s,
          start: i,
          end: a,
          ld_refvar: n,
          genome_build: o,
          ld_source: r,
          ld_population: l,
        } = t;
      return [
        super._getURL(t),
        "genome_builds/",
        o,
        "/references/",
        r,
        "/populations/",
        l,
        "/variants",
        "?correlation=",
        e,
        "&variant=",
        encodeURIComponent(n),
        "&chrom=",
        encodeURIComponent(s),
        "&start=",
        encodeURIComponent(i),
        "&stop=",
        encodeURIComponent(a),
      ].join("");
    }
    _getCacheKey(t) {
      const e = super._getCacheKey(t),
        { ld_refvar: s, ld_source: i, ld_population: a } = t;
      return `${e}_${s}_${i}_${a}`;
    }
    _performRequest(t) {
      if (t._skip_request) return Promise.resolve([]);
      const e = this._getURL(t);
      let s = {
          data: {},
        },
        i = function (t) {
          return fetch(t)
            .then()
            .then((t) => {
              if (!t.ok) throw new Error(t.statusText);
              return t.text();
            })
            .then(function (t) {
              return (
                (t = JSON.parse(t)),
                Object.keys(t.data).forEach(function (e) {
                  s.data[e] = (s.data[e] || []).concat(t.data[e]);
                }),
                t.next ? i(t.next) : s
              );
            });
        };
      return i(e);
    }
  }
  LocusZoom.Adapters.add("Custom-LdServer", LdServer);
}

if (typeof LocusZoom !== "undefined") {
  // Auto-register the plugin when included as a script tag. ES6 module users must register via LocusZoom.use()
  // eslint-disable-next-line no-undef
  LocusZoom.use(install);
}

export default install;
