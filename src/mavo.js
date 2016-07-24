(function ($, $$) {

"use strict";

var _ = self.Mavo = $.Class({
	constructor: function (element) {
		_.all.push(this);

		// TODO escaping of # and \
		var dataStore = (location.search.match(/[?&]store=([^&]+)/) || [])[1] ||
		                element.getAttribute("data-store") || "";
		this.store = dataStore === "none"? null : dataStore;

		// Assign a unique (for the page) id to this mavo instance
		this.id = Mavo.Node.getProperty(element) || element.id || "mv-" + _.all.length;

		this.autoEdit = _.has("autoedit", element);

		this.element = _.is("scope", element)? element : $(_.selectors.rootScope, element);

		if (!this.element) {
			element.setAttribute("typeof", element.getAttribute("property") || "");
			element.removeAttribute("property");
			this.element = element;
		}

		this.element.classList.add("mv-root");

		// Apply heuristic for collections
		$$(_.selectors.property + ", " + _.selectors.scope).concat([this.element]).forEach(element => {
			if (_.is("autoMultiple", element) && !element.hasAttribute("data-multiple")) {
				element.setAttribute("data-multiple", "");
			}
		});

		this.wrapper = element.closest(".mv-wrapper") || element;

		// Ctrl + S or Cmd + S to save
		this.wrapper.addEventListener("keydown", evt => {
			if (evt.keyCode == 83 && evt[_.superKey]) {
				evt.preventDefault();
				this.save();
			}
		});

		// Apply heuristic for scopes
		$$(_.selectors.primitive).forEach(element => {
			var isScope = $(Mavo.selectors.property, element) && (// Contains other properties and...
			                Mavo.is("multiple", element) || // is a collection...
			                Mavo.Primitive.getValueAttribute(element) === null  // ...or its content is not in an attribute
						) || element.matches("template");

			if (isScope) {
				element.setAttribute("typeof", "");
			}
		});

		if (this.wrapper === this.element && _.is("multiple", element)) {
			// Need to create a wrapper
			var around = this.element;

			// Avoid producing invalid HTML
			if (this.element.matches("li, option")) {
				around = around.parentNode;
			}
			else if (this.element.matches("td, tr, tbody, thead, tfoot")) {
				around = around.closest("table");
			}

			this.wrapper = $.create({ around });
		}

		this.wrapper.classList.add("mv-wrapper");

		// Normalize property names
		this.propertyNames = [];

		// Is there any control that requires an edit button?
		this.needsEdit = false;

		// Build mavo objects
		Mavo.hooks.run("init-tree-before", this);

		this.root = Mavo.Node.create(this.element, this);
		this.propertyNames = this.propertyNames.sort((a, b) => b.length - a.length);

		Mavo.hooks.run("init-tree-after", this);

		this.walk(obj => {
			if (obj.unsavedChanges) {
				obj.unsavedChanges = false;
			}
		});

		this.permissions = new Mavo.Permissions(null, this);

		var inlineBar = this.wrapper.hasAttribute("data-bar")?
		                  this.wrapper.matches("[data-bar~=inline]") :
		                  (_.all.length > 1 && getComputedStyle(this.wrapper).transform == "none");

		this.ui = {
			bar: $(".mv-bar", this.wrapper) || $.create({
				className: "mv-bar mv-ui" + (inlineBar? " inline" : ""),
				start: this.wrapper,
				contents: {
					tag: "span",
					className: "status",
				}
			})
		};

		_.observe(this.wrapper, "class", () => {
			var p = this.permissions;
			var floating = !this.editing && (p.login || p.edit && !p.login && !(p.save && this.unsavedChanges));
			this.ui.bar.classList.toggle("floating", floating);
		});

		this.permissions.onchange(({action, value}) => {
			this.wrapper.classList.toggle(`can-${action}`, value);
		});

		this.permissions.can(["edit", "add", "delete"], () => {
			this.ui.edit = $.create("button", {
				className: "edit",
				textContent: "Edit",
				onclick: e => this.editing? this.done() : this.edit(),
				inside: this.ui.bar
			});

			if (this.autoEdit) {
				requestAnimationFrame(() => this.ui.edit.click());
			}
		}, () => { // cannot
			$.remove(this.ui.edit);

			if (this.editing) {
				this.done();
			}
		});

		if (this.needsEdit) {
			this.permissions.can("save", () => {
				this.ui.save = $.create("button", {
					className: "save",
					textContent: "Save",
					events: {
						click: e => this.save(),
						"mouseenter focus": e => {
							this.wrapper.classList.add("save-hovered");
							this.unsavedChanges = this.calculateUnsavedChanges();
						},
						"mouseleave blur": e => this.wrapper.classList.remove("save-hovered")
					},
					inside: this.ui.bar
				});

				this.ui.revert = $.create("button", {
					className: "revert",
					textContent: "Revert",
					disabled: true,
					events: {
						click: e => this.revert(),
						"mouseenter focus": e => {
							if (!this.unsavedChanges) {
								this.wrapper.classList.add("revert-hovered");
								this.unsavedChanges = this.calculateUnsavedChanges();
							}
						},
						"mouseleave blur": e => this.wrapper.classList.remove("revert-hovered")
					},
					inside: this.ui.bar
				});
			}, () => {
				$.remove([this.ui.save, this.ui.revert]);
				this.ui.save = this.ui.revert = null;
			});
		}

		this.permissions.can("delete", () => {
			this.ui.clear = $.create("button", {
				className: "clear",
				textContent: "Clear",
				onclick: e => this.clear()
			});

			this.ui.bar.appendChild(this.ui.clear);
		});

		this.permissions.cannot(["delete", "edit"], () => {
			$.remove(this.ui.clear);
		});

		// Fetch existing data

		if (this.store) {
			this.storage = new _.Storage(this);

			this.permissions.can("read", () => this.storage.load());
		}
		else {
			// No storage
			this.permissions.on(["read", "edit"]);

			$.fire(this.wrapper, "mavo:load");
		}

		if (!this.needsEdit) {
			this.permissions.off(["edit", "add", "delete"]);
		}

		Mavo.hooks.run("init-end", this);
	},

	get data() {
		return this.getData();
	},

	getData: function(o) {
		return this.root.getData(o);
	},

	toJSON: function(data = this.data) {
		return _.toJSON(data);
	},

	render: function(data) {
		_.hooks.run("render-start", {context: this, data});

		if (data) {
			this.root.render(data);
		}

		this.unsavedChanges = false;
	},

	clear: function() {
		if (confirm("This will delete all your data. Are you sure?")) {
			this.storage && this.storage.clear();
			this.root.clear();
		}
	},

	edit: function() {
		this.editing = true;

		this.root.edit();

		$.events(this.wrapper, "mouseenter.mavo:edit mouseleave.mavo:edit", evt => {
			if (evt.target.matches(".mv-item-controls .delete")) {
				var item = evt.target.closest(_.selectors.item);
				item.classList.toggle("delete-hover", evt.type == "mouseenter");
			}

			if (evt.target.matches(_.selectors.item)) {
				evt.target.classList.remove("has-hovered-item");

				var parent = evt.target.parentNode.closest(_.selectors.item);

				if (parent) {
					parent.classList.toggle("has-hovered-item", evt.type == "mouseenter");
				}
			}
		}, true);

		this.unsavedChanges = this.calculateUnsavedChanges();
	},

	calculateUnsavedChanges: function() {
		var unsavedChanges = false;

		this.walk(obj => {
			if (obj.unsavedChanges) {
				unsavedChanges = true;
				return false;
			}
		});

		return unsavedChanges;
	},

	// Conclude editing
	done: function() {
		this.root.done();
		$.unbind(this.wrapper, ".mavo:edit");
		this.editing = false;
		this.unsavedChanges = false;
	},

	save: function() {
		this.root.save();

		if (this.storage) {
			this.storage.save();
		}

		this.unsavedChanges = false;
	},

	revert: function() {
		this.root.revert();
	},

	walk: function(callback) {
		this.root.walk(callback);
	},

	live: {
		editing: {
			set: function(value) {
				this.wrapper.classList.toggle("editing", value);

				if (value) {
					this.wrapper.setAttribute("data-editing", "");
				}
				else {
					this.wrapper.removeAttribute("data-editing");
				}
			}
		},

		unsavedChanges: function(value) {
			this.wrapper.classList.toggle("unsaved-changes", value);

			if (this.ui && this.ui.save) {
				this.ui.save.disabled = !value;
				this.ui.revert.disabled = !value;
			}
		}
	},

	static: {
		all: [],

		superKey: navigator.platform.indexOf("Mac") === 0? "metaKey" : "ctrlKey",

		init: (container) => $$("[data-store]", container).map(element => new _(element)),

		toJSON: data => {
			if (data === null) {
				return "";
			}

			if (typeof data === "string") {
				// Do not stringify twice!
				return data;
			}

			return JSON.stringify(data, null, "\t");
		},

		// Convert an identifier to readable text that can be used as a label
		readable: function (identifier) {
			// Is it camelCase?
			return identifier && identifier
			         .replace(/([a-z])([A-Z])(?=[a-z])/g, ($0, $1, $2) => $1 + " " + $2.toLowerCase()) // camelCase?
			         .replace(/([a-z])[_\/-](?=[a-z])/g, "$1 ") // Hyphen-separated / Underscore_separated?
			         .replace(/^[a-z]/, $0 => $0.toUpperCase()); // Capitalize
		},

		// Inverse of _.readable(): Take a readable string and turn it into an identifier
		identifier: function (readable) {
			readable = readable + "";
			return readable && readable
			         .replace(/\s+/g, "-") // Convert whitespace to hyphens
			         .replace(/[^\w-]/g, "") // Remove weird characters
			         .toLowerCase();
		},

		queryJSON: function(data, path) {
			if (!path || !data) {
				return data;
			}

			return $.value.apply($, [data].concat(path.split("/")));
		},

		observe: function(element, attribute, callback, oldValue) {
			var observer = $.type(callback) == "function"? new MutationObserver(callback) : callback;

			var options = attribute? {
					attributes: true,
					attributeFilter: [attribute],
					attributeOldValue: !!oldValue
				} : {
					characterData: true,
					childList: true,
					subtree: true,
					characterDataOldValue: !!oldValue
				};

			observer.observe(element, options);

			return observer;
		},

		// If the passed value is not an array, convert to an array
		toArray: arr => {
			return Array.isArray(arr)? arr : [arr];
		},

		// Recursively flatten a multi-dimensional array
		flatten: arr => {
			if (!Array.isArray(arr)) {
				return [arr];
			}

			return arr.reduce((prev, c) => _.toArray(prev).concat(_.flatten(c)), []);
		},

		is: function(thing, element) {
			return element.matches && element.matches(_.selectors[thing]);
		},

		has: function(option, element) {
			return element.matches && element.matches(_.selectors.option(option));
		},

		hooks: new $.Hooks()
	}
});

{

let s = _.selectors = {
	property: "[property], [itemprop]",
	specificProperty: name => `[property=${name}], [itemprop=${name}]`,
	scope: "[typeof], [itemscope], [itemtype], .scope",
	multiple: "[multiple], [data-multiple], .multiple",
	required: "[required], [data-required], .required",
	formControl: "input, select, textarea",
	computed: ".computed", // Properties or scopes with computed properties, will not be saved
	item: ".mv-item",
	ui: ".mv-ui",
	option: name => `[${name}], [data-${name}], [data-mv-options~='${name}'], .${name}`,
	container: {
		"li": "ul, ol",
		"tr": "table",
		"option": "select",
		"dt": "dl",
		"dd": "dl"
	},
	documentFragment: ".document-fragment"
};

let arr = s.arr = selector => selector.split(/\s*,\s*/g);
let not = s.not = selector => arr(selector).map(s => `:not(${s})`).join("");
let or = s.or = (selector1, selector2) => selector1 + ", " + selector2;
let and = s.and = (selector1, selector2) => _.flatten(
		arr(selector1).map(s1 => arr(selector2).map(s2 => s1 + s2))
	).join(", ");
let andNot = s.andNot = (selector1, selector2) => and(selector1, not(selector2));

$.extend(_.selectors, {
	primitive: andNot(s.property, s.scope),
	rootScope: andNot(s.scope, s.property),
	output: or(s.specificProperty("output"), ".output, .value"),
	autoMultiple: and("li, tr, option", ":only-of-type")
});

}

// Bliss plugins

// Provide shortcuts to long property chains
$.proxy = $.classProps.proxy = $.overload(function(obj, property, proxy) {
	Object.defineProperty(obj, property, {
		get: function() {
			return this[proxy][property];
		},
		set: function(value) {
			this[proxy][property] = value;
		},
		configurable: true,
		enumerable: true
	});

	return obj;
});

$.classProps.propagated = function(proto, names) {
	Mavo.toArray(names).forEach(name => {
		var existing = proto[name];

		proto[name] = function() {
			var ret = existing && existing.apply(this, arguments);

			if (this.propagate && ret !== false) {
				this.propagate(name);
			}
		};
	});
};

// :focus-within shim
document.addEventListener("focus", evt => {
	$$(".focus-within").forEach(el => el.classList.remove("focus-within"));

	var element = evt.target;

	while (element = element.parentNode) {
		if (element.classList) {
			element.classList.add("focus-within");
		}
	}
}, true);

// Init mavo
Promise.all([
	$.ready(),
	$.include(Array.from && window.Intl && document.documentElement.closest, "https://cdn.polyfill.io/v2/polyfill.min.js?features=blissfuljs,Intl.~locale.en")
])
.then(() => Mavo.init())
.catch(err => {
	console.error(err);
	Mavo.init();
});

Stretchy.selectors.filter = ".mv-editor:not([property])";

})(Bliss, Bliss.$);
