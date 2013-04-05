angular.module('kibana.map2', [])
    .controller('map2', function ($scope, eventBus) {

        // Set and populate defaults
        var _d = {
            query: "*",
            map: "world",
            colors: ['#C8EEFF', '#0071A4'],
            size: 100,
            exclude: [],
            spyable: true,
            group: "default",
            index_limit: 0,
            display: {
                data: {
                  samples: 1000
                },
                geopoints: {
                    enabled: true,
                    enabledText: "Enabled",
                    pointSize: 1,
                    pointAlpha: 0.6
                },
                binning: {
                    enabled: true,
                    hexagonSize: 10,
                    hexagonAlpha: 1.0,
                    areaEncoding: true,
                    areaEncodingField: "primary",
                    colorEncoding: true,
                    colorEncodingField: "primary"
                }
            },
            displayTabs: ["Geopoints", "Binning", "Data"],
            activeDisplayTab:"Geopoints"
        };

        _.defaults($scope.panel, _d)

        $scope.init = function () {
            console.log("init");
            eventBus.register($scope, 'time', function (event, time) {
                set_time(time)
            });
            eventBus.register($scope, 'query', function (event, query) {
                $scope.panel.query = _.isArray(query) ? query[0] : query;
                $scope.get_data();
            });
            // Now that we're all setup, request the time from our group
            eventBus.broadcast($scope.$id, $scope.panel.group, 'get_time')
        };

        $scope.isNumber = function (n) {
            return !isNaN(parseFloat(n)) && isFinite(n);
        };

        $scope.get_data = function () {

            console.log("get_data");
            // Make sure we have everything for the request to complete
            if (_.isUndefined($scope.panel.index) || _.isUndefined($scope.time))
                return


            $scope.panel.loading = true;
            var request = $scope.ejs.Request().indices($scope.panel.index);


            console.log("fields", $scope.panel.field, $scope.panel.secondaryfield);

            //Use a regular term facet if there is no secondary field
            if (typeof $scope.panel.secondaryfield === "undefined") {
                var facet = $scope.ejs.TermsFacet('map')
                    .field($scope.panel.field)
                    .size($scope.panel.display.data.samples)
                    .exclude($scope.panel.exclude)
                    .facetFilter(ejs.QueryFilter(
                        ejs.FilteredQuery(
                            ejs.QueryStringQuery($scope.panel.query || '*'),
                            ejs.RangeFilter($scope.time.field)
                                .from($scope.time.from)
                                .to($scope.time.to))));
            } else {
                //otherwise, use term stats
                //NOTE: this will break if valueField is a geo_point
                //      need to put in checks for that
                var facet = $scope.ejs.TermStatsFacet('map')
                    .keyField($scope.panel.field)
                    .valueField($scope.panel.secondaryfield)
                    .size($scope.panel.display.data.samples)
                    .facetFilter(ejs.QueryFilter(
                        ejs.FilteredQuery(
                            ejs.QueryStringQuery($scope.panel.query || '*'),
                            ejs.RangeFilter($scope.time.field)
                                .from($scope.time.from)
                                .to($scope.time.to))));
            }





            // Then the insert into facet and make the request
            var request = request.facet(facet).size(0);

            $scope.populate_modal(request);

            var results = request.doSearch();


            // Populate scope when we have results
            results.then(function (results) {
                $scope.panel.loading = false;
                $scope.hits = results.hits.total;
                $scope.data = {};


                _.each(results.facets.map.terms, function (v) {

                    var metric = 'count';

                    //If it is a Term facet, use count, otherwise use Total
                    //May retool this to allow users to pick mean/median/etc
                    if (typeof $scope.panel.secondaryfield === "undefined") {
                        metric = 'count';
                    } else {
                        metric = 'total';
                    }

                    //FIX THIS
                    if (!$scope.isNumber(v.term)) {
                        $scope.data[v.term.toUpperCase()] = v[metric];
                    } else {
                        $scope.data[v.term] = v[metric];
                    }
                });

                console.log("emit render");
                $scope.$emit('render')
            });
        };

        // I really don't like this function, too much dom manip. Break out into directive?
        $scope.populate_modal = function (request) {
            $scope.modal = {
                title: "Inspector",
                body: "<h5>Last Elasticsearch Query</h5><pre>" + 'curl -XGET ' + config.elasticsearch + '/' + $scope.panel.index + "/_search?pretty -d'\n" + angular.toJson(JSON.parse(request.toString()), true) + "'</pre>",
            }
        };

        function set_time(time) {
            $scope.time = time;
            $scope.panel.index = _.isUndefined(time.index) ? $scope.panel.index : time.index
            $scope.get_data();
        }

        $scope.build_search = function (field, value) {
            $scope.panel.query = add_to_query($scope.panel.query, field, value, false)
            $scope.get_data();
            eventBus.broadcast($scope.$id, $scope.panel.group, 'query', $scope.panel.query);
        };

        $scope.isActive = function(tab) {
            return (tab.toLowerCase() === $scope.panel.activeDisplayTab.toLowerCase());
        }

        $scope.tabClick = function(tab) {
            $scope.panel.activeDisplayTab = tab;
        }

    })
    .filter('enabledText', function() {
        return function (value) {
            if (value === true) {
                return "Enabled";
            } else {
                return "Disabled";
            }
        }
    })
    .directive('map2', function () {
        return {
            restrict: 'A',
            link: function (scope, elem, attrs) {

                elem.html('<center><img src="common/img/load_big.gif"></center>')

                // Receive render events
                scope.$on('render', function () {
                    console.log("render");
                    render_panel();
                });

                // Or if the window is resized
                angular.element(window).bind('resize', function () {
                    console.log("resize");
                    render_panel();
                });

                function render_panel() {
                    //console.log("render_panel");
                    //console.log(scope.panel);
                    //console.log(elem);

                    // Using LABjs, wait until all scripts are loaded before rendering panel
                    var scripts = $LAB.script("panels/map2/lib/d3.v3.min.js")
                        .script("panels/map2/lib/topojson.v0.min.js")
                        .script("panels/map2/lib/node-geohash.js")
                        .script("panels/map2/lib/d3.hexbin.v0.min.js");

                    // Populate element. Note that jvectormap appends, does not replace.
                    scripts.wait(function () {
                        elem.text('');

                        //Better way to get these values?  Seems kludgy to use jQuery on the div...
                        var width = $(elem[0]).width(),
                            height = $(elem[0]).height();

                        console.log("draw map", width, height);

                        //Scale the map by whichever dimension is the smallest, helps to make sure the whole map is shown
                        var scale = (width > height) ? (height / 2 / Math.PI) : (width / 2 / Math.PI);

                        var projection = d3.geo.mercator()
                            .translate([0, 0])
                            .scale(scale);

                        var zoom = d3.behavior.zoom()
                            .scaleExtent([1, 8])
                            .on("zoom", move);

                        var path = d3.geo.path()
                            .projection(projection);

                        var svg = d3.select(elem[0]).append("svg")
                            .attr("width", width)
                            .attr("height", height)
                            .append("g")
                            .attr("transform", "translate(" + width / 2 + "," + height / 2 + ")")
                            .call(zoom);

                        var g = svg.append("g");

                        svg.append("rect")
                            .attr("class", "overlay")
                            .attr("x", -width / 2)
                            .attr("y", -height / 2)
                            .attr("width", width)
                            .attr("height", height);

                        d3.json("panels/map2/lib/world-50m.json", function (error, world) {
                            g.append("path")
                                .datum(topojson.object(world, world.objects.countries))
                                .attr("class", "land")
                                .attr("d", path);

                            g.append("path")
                                .datum(topojson.mesh(world, world.objects.countries, function (a, b) {
                                    return a !== b;
                                }))
                                .attr("class", "boundary")
                                .attr("d", path);





                            //Geocoded points are decoded into lat/lon, then projected onto x/y
                            points = _.map(scope.data, function (k, v) {
                                var decoded = geohash.decode(v);
                                return projection([decoded.longitude, decoded.latitude]);
                            });


                            var binPoints = [];

                            //primary field is just binning raw counts
                            //secondary field is binning some metric like mean/median/total.  Hexbins doesn't support that,
                            //so we cheat a little and just add more points to compensate.
                            //However, we don't want to add a million points, so normalize against the largest value
                            if (scope.panel.display.binning.areaEncodingField === 'secondary') {
                                var max = Math.max.apply(Math, _.map(scope.data, function(k,v){return k;})),
                                    scale = 10/max;

                                _.map(scope.data, function (k, v) {
                                    var decoded = geohash.decode(v);
                                    return _.map(_.range(0, k*scale), function(a,b) {
                                        binPoints.push(projection([decoded.longitude, decoded.latitude]));
                                    })
                                });

                            } else {
                                binPoints = points;
                            }




                            //hexagonal binning
                            if (scope.panel.display.binning.enabled) {

                                var hexbin = d3.hexbin()
                                    .size([width, height])
                                    .radius(scope.panel.display.binning.hexagonSize);

                                //bin and sort the points, so we can set the various ranges appropriately
                                var binnedPoints = hexbin(binPoints).sort(function(a, b) { return b.length - a.length; });;
console.log(binnedPoints);
                                //clean up some memory
                                binPoints = [];


                                var radius = d3.scale.sqrt()
                                    .domain([0, binnedPoints[0].length])
                                    .range([0, scope.panel.display.binning.hexagonSize]);


                                var color = d3.scale.linear()
                                    .domain([0,binnedPoints[0].length])
                                    .range(["white", "steelblue"])
                                    .interpolate(d3.interpolateLab);

                                g.selectAll(".hexagon")
                                    .data(binnedPoints)
                                    .enter().append("path")
                                    .attr("d", function (d) {
                                        if (scope.panel.display.binning.areaEncoding === false) {
                                            return hexbin.hexagon();
                                        } else {
                                            return hexbin.hexagon(radius(d.length));
                                        }
                                    })
                                    .attr("class", "hexagon")
                                    .attr("transform", function (d) {
                                        return "translate(" + d.x + "," + d.y + ")";
                                    })
                                    .style("fill", function (d) {
                                        if (scope.panel.display.binning.colorEncoding === false) {
                                            return color(binnedPoints[0].length / 2);
                                        } else {
                                            return color(d.length);
                                        }
                                    })
                                    .attr("opacity", scope.panel.display.binning.hexagonAlpha);
                            }


                            //Raw geopoints
                            if (scope.panel.display.geopoints.enabled) {
                                g.selectAll("circles.points")
                                    .data(points)
                                    .enter()
                                    .append("circle")
                                    .attr("r", scope.panel.display.geopoints.pointSize)
                                    .attr("opacity", scope.panel.display.geopoints.pointAlpha)
                                    .attr("transform", function (d) {
                                        return "translate(" + d[0] + "," + d[1] + ")";
                                    });
                            }


                        });

                        function move() {
                            var t = d3.event.translate,
                                s = d3.event.scale;
                            t[0] = Math.min(width / 2 * (s - 1), Math.max(width / 2 * (1 - s), t[0]));
                            t[1] = Math.min(height / 2 * (s - 1) + 230 * s, Math.max(height / 2 * (1 - s) - 230 * s, t[1]));
                            zoom.translate(t);
                            g.style("stroke-width", 1 / s).attr("transform", "translate(" + t + ")scale(" + s + ")");
                        }

                    })
                }

            }
        };
    });