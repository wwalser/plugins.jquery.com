var fs = require( "fs" ),
	querystring = require( "querystring" ),
	exec = require( "child_process" ).exec,
	Step = require( "step" ),
	mkdirp = require( "mkdirp" ),
	service = require( "../service" );

var reBitbucketUrl = /^https?:\/\/bitbucket\.org\/([^\/]+)\/([^\/]+)(\/.*)?$/;

function dirname( path ) {
	path = path.split( "/" );
	path.pop();
	return path.join( "/" );
}

function extend( a, b ) {
	for ( var prop in b ) {
		a[ prop ] = b[ prop ];
	}
}

function repoFromHook( data ) {
	var matches = reBitbucketUrl.exec( data.repository.url ),
		repo = new BitbucketRepo( matches[ 1 ], matches[ 2 ] );

	repo.forks = data.repository.forks;
	repo.watchers = data.repository.watchers;
	return repo;
}

function BitbucketRepo( userName, repoName ) {
	if ( arguments.length === 1 ) {
		return repoFromHook( userName );
	}

	var partialPath = "/" + userName + "/" + repoName;

	this.userName = userName;
	this.repoName = repoName;
	this.siteUrl = "http://bitbucket.org" + partialPath;
	this.sourceUrl = "git://bitbucket.org" + partialPath + ".git";

	service.Repo.call( this );
}

BitbucketRepo.test = function( data ) {
	try {
		data = querystring.parse( data );
		data = JSON.parse( data.payload );
	} catch( error ) {
		return null;
	}

	if ( reBitbucketUrl.test( data.repository && data.repository.url ) ) {
		return data;
	}

	return null;
};

// service interface
extend( BitbucketRepo.prototype, new service.Repo() );
extend( BitbucketRepo.prototype, {
	downloadUrl: function( version ) {
		return this.siteUrl + "/zipball/" + version;
	},

	getTags: function( fn ) {
		var repo = this;
		Step(
			// fetch the repo
			function() {
				repo.fetch( this );
			},

			// get the tags
			function( error ) {
				if ( error ) {
					return fn( error );
				}

				exec( "git tag", { cwd: repo.path }, this );
			},

			// parse the tags
			function( error, stdout ) {
				if ( error ) {
					return fn( error );
				}

				var tags = stdout.split( "\n" );
				tags.pop();
				fn( null, tags );
			}
		);
	},

	getManifestFiles: function( tag, fn ) {
		exec( "git ls-tree " + tag + " --name-only", { cwd: this.path }, function( error, stdout ) {
			if ( error ) {
				return fn( error );
			}

			// filter to *.jquery.json
			fn( null, stdout.split( "\n" ).filter(function( file ) {
				return file.indexOf( ".jquery.json" ) > 0;
			}));
		});
	},

	_getManifest: function( version, file, fn ) {
		version = version || "master";
		exec( "git show " + version + ":" + file, { cwd: this.path }, function( error, stdout ) {
			if ( error ) {
				return fn( error );
			}

			fn( null, stdout.trim() );
		});
	},

	getReleaseDate: function( tag, fn ) {
		exec( "git log --pretty='%cD' -1 " + tag, { cwd: this.path }, function( error, stdout ) {
			if ( error ) {
				return fn( error );
			}

			fn( null, new Date( stdout ) );
		});
	},

	restore: function( fn ) {
		this.fetch( fn );
	}
});

// internals
extend( BitbucketRepo.prototype, {
	fetch: function( fn ) {
		var repo = this;

		Step(
			// make sure the user directory exists
			function() {
				mkdirp( dirname( repo.path ), "0755", this );
			},

			// check if the repo already exists
			function( error ) {
				if ( error ) {
					return fn( error );
				}

				fs.stat( repo.path, this );
			},

			// create or update the repo
			function( error ) {
				// repo already exists
				if ( !error ) {
					exec( "git fetch -t", { cwd: repo.path }, this );
					return;
				}

				// error other than repo not existing
				if ( error.code !== "ENOENT" ) {
					return fn( error );
				}

				exec( "git clone " + repo.sourceUrl + " " + repo.path, this );
			},

			function( error ) {
				fn( error );
			}
		);
	}
});

service.register( "bitbucket", BitbucketRepo );
